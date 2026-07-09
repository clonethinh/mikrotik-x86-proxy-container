# ============================================================
# quayip.rsc — PPPoE IP rotator (proxy pool pppoe-out1..N)
# pppoe-wan excluded. Scheduler: every 10 minutes.
# ============================================================

/system script remove [find name=quayip]
/system script add dont-require-permissions=no name=quayip owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={

# =========================================================
#  PPPoE IP Rotator - 5m scheduler, 16 lan quay/phien, CGNAT+169.254
#  - Ping theo src-address + retry        -> het fail gia
#  - Tach "IP xau" vs "IP dep mat net"    -> khong vut IP dep
#  - Nho trang thai qua comment "OK"       -> chay lai khong quay so oan
#  - Marker "DEAD" + khoi hoi sinh         -> phien da tat duoc bat lai thu IP moi
#  - Dem/bao cao day du, ke ca phien da tat
# =========================================================

# ==== Cau hinh ====
:local maxFail        16      ;# so lan quay so toi da moi phien -> tat han (tang phuc hoi)
:local maxNetFail     3       ;# IP dep nhung mat net: so lan kien nhan truoc khi quay so
:local maxPass        60      ;# so vong lap toi da (chong lap vo han)
:local waitSec        8       ;# cho giua cac vong cho PPPoE reconnect (nhanh hon)
:local settleSec      5       ;# cho on dinh truoc lan kiem tra dau tien
:local pingCount      3       ;# so goi ping moi host
:local pingTries      3       ;# so lan thu lai ping truoc khi ket luan mat net
:local pingHosts      {"8.8.8.8";"1.1.1.1"}
:local rejectPrivate  false   ;# true = coi ca IP private la xau
:local useComment     true    ;# true = tin comment "OK" de bo qua phien tot khi chay lai
:local reviveDead     true    ;# true = dau moi lan chay, bat lai cac phien script da tat (comment=DEAD)

:local ipFails  [:toarray ""] ;# dem lan IP xau / quay so
:local netFails [:toarray ""] ;# dem lan IP dep nhung mat net
:local done     [:toarray ""] ;# phien da dat
:local dead     [:toarray ""] ;# phien da bi tat han

# ==== Ham: IP co "xau" khong (parse octet dong nhat bang :tonum) ====
:local isBad do={
    :if ([:len $ip] = 0) do={ :return true }
    :local p1 [:find $ip "."]
    :if ([:typeof $p1] = "nil") do={ :return true }
    :local o1 [:tonum [:pick $ip 0 $p1]]
    :local r1 [:pick $ip ($p1 + 1) [:len $ip]]
    :local p2 [:find $r1 "."]
    :if ([:typeof $p2] = "nil") do={ :return true }
    :local o2 [:tonum [:pick $r1 0 $p2]]

    :if (($o1 = 169) and ($o2 = 254)) do={ :return true }                  ;# link-local 169.254/16
    :if (($o1 = 100) and ($o2 >= 64) and ($o2 <= 127)) do={ :return true } ;# CGNAT 100.64/10
    :if ($priv = true) do={
        :if ($o1 = 10) do={ :return true }
        :if (($o1 = 192) and ($o2 = 168)) do={ :return true }
        :if (($o1 = 172) and ($o2 >= 16) and ($o2 <= 31)) do={ :return true }
    }
    :return false
}

# ==== Ham: co ra net khong (ping theo src-address, co retry) ====
:local netOk do={
    :for i from=1 to=$tries do={
        :foreach h in=$hosts do={
            :if ([/ping $h src-address=$sip interface=$nm count=$cnt] > 0) do={ :return true }
        }
        :delay 1s
    }
    :return false
}

# ==== Ham: lay IP (bo mask) cua 1 interface, "" neu chua co ====
:local getIp do={
    :local aid [/ip address find where interface=$nm]
    :if ([:len $aid] = 0) do={ :return "" }
    :local a [/ip address get [:pick $aid 0] address]
    :return [:pick $a 0 [:find $a "/"]]
}

# ==== Hoi sinh cac phien script da tu tat lan truoc (comment=DEAD) ====
:if ($reviveDead = true) do={
    :foreach pc in=[/interface pppoe-client find where disabled=yes and name!="pppoe-wan" and comment="DEAD"] do={
        :local nm  [/interface pppoe-client get $pc name]
        :local cmt [/interface pppoe-client get $pc comment]
        :if ($cmt = "DEAD") do={
            /interface pppoe-client set $pc comment=""
            /interface pppoe-client enable $pc
            :log info ("$nm: hoi sinh -> bat lai de thu IP moi")
        }
    }
    :delay 2s
}

# ==== Cho PPPoE on dinh truoc khi kiem tra lan dau ====
:log info ("PPPoE rotator: cho $settleSec s cho cac phien on dinh...")
:delay $settleSec

# ==== Vong chinh ====
:local pass 0
:local remaining 1
:while (($remaining > 0) and ($pass < $maxPass)) do={
    :set pass ($pass + 1)
    :set remaining 0
    :foreach pc in=[/interface pppoe-client find where disabled=no and name!="pppoe-wan"] do={
        :local nm [/interface pppoe-client get $pc name]
        :if (($done->$nm) != true) do={
            :local ip    [$getIp nm=$nm]
            :local ipBad [$isBad ip=$ip priv=$rejectPrivate]

            # --- Nho trang thai: comment=OK va IP van dep -> tin, bo qua ping ---
            :local cmt [/interface pppoe-client get $pc comment]
            :if (($useComment = true) and ($cmt = "OK") and ($ipBad = false)) do={
                :set ($done->$nm) true
                :log info ("$nm OK (tin comment) = $ip")
            } else={
                :if ($ipBad = true) do={
                    # ===== IP xau: quay so ngay (IP nay se khong tot len) =====
                    :local f 0
                    :if ([:typeof ($ipFails->$nm)] = "num") do={ :set f ($ipFails->$nm) }
                    :set f ($f + 1)
                    :set ($ipFails->$nm) $f
                    :set ($netFails->$nm) 0
                    :if ($f >= $maxFail) do={
                        /interface pppoe-client disable $pc
                        /interface pppoe-client set $pc comment="DEAD"
                        :set ($dead->$nm) true
                        :log error ("$nm: IP xau/that bai $f lan -> TAT (pool ISP het cho)")
                    } else={
                        /interface pppoe-client set $pc comment=""
                        :set remaining ($remaining + 1)
                        /interface pppoe-client disable $pc
                        :delay ([:rndnum from=1 to=3] . "s")
                        /interface pppoe-client enable $pc
                        :local why "IP xau ($ip)"
                        :if ([:len $ip] = 0) do={ :set why "chua nhan IP" }
                        :log info ("$nm ($why, lan $f) -> quay so lai")
                    }
                } else={
                    # ===== IP dep: kiem tra co ra net that khong =====
                    :if ([$netOk nm=$nm sip=$ip hosts=$pingHosts cnt=$pingCount tries=$pingTries] = true) do={
                        :set ($done->$nm) true
                        :set ($ipFails->$nm) 0
                        :set ($netFails->$nm) 0
                        /interface pppoe-client set $pc comment="OK"
                        :log info ("$nm OK = $ip")
                    } else={
                        # IP dep nhung mat net: kien nhan truoc, KHONG vut IP dep ngay
                        :local g 0
                        :if ([:typeof ($netFails->$nm)] = "num") do={ :set g ($netFails->$nm) }
                        :set g ($g + 1)
                        :set ($netFails->$nm) $g
                        :if ($g < $maxNetFail) do={
                            :set remaining ($remaining + 1)
                            :log warning ("$nm IP dep ($ip) nhung mat net (lan $g/$maxNetFail) -> cho, GIU IP")
                        } else={
                            # mat net keo dai -> danh doi IP, quay so xin phien moi
                            :local f 0
                            :if ([:typeof ($ipFails->$nm)] = "num") do={ :set f ($ipFails->$nm) }
                            :set f ($f + 1)
                            :set ($ipFails->$nm) $f
                            :set ($netFails->$nm) 0
                            :if ($f >= $maxFail) do={
                                /interface pppoe-client disable $pc
                                /interface pppoe-client set $pc comment="DEAD"
                                :set ($dead->$nm) true
                                :log error ("$nm: mat net keo dai, that bai $f lan -> TAT")
                            } else={
                                /interface pppoe-client set $pc comment=""
                                :set remaining ($remaining + 1)
                                /interface pppoe-client disable $pc
                                :delay ([:rndnum from=1 to=3] . "s")
                                /interface pppoe-client enable $pc
                                :log info ("$nm mat net keo dai (lan $f) -> quay so lai")
                            }
                        }
                    }
                }
            }
        }
    }
    :log warning ("Pass $pass: con $remaining phien dang thu")
    :if ($remaining > 0) do={ :delay $waitSec }
}

# ==== Tong ket ====
:local okCount 0
:local deadCount 0
:foreach k,v in=$done do={ :if ($v = true) do={ :set okCount   ($okCount + 1) } }
:foreach k,v in=$dead do={ :if ($v = true) do={ :set deadCount ($deadCount + 1) } }

:if ($remaining = 0) do={
    :log warning ("XONG sau $pass pass: $okCount phien ra net, $deadCount phien bi TAT")
} else={
    :log error ("Dung sau $maxPass pass: $okCount OK, $deadCount bi TAT, $remaining chua xong")
}

# ==== Bao cao chi tiet (bao gom ca phien da bi tat) ====
:log warning "----- BAO CAO -----"
:foreach pc in=[/interface pppoe-client find] do={
    :local nm  [/interface pppoe-client get $pc name]
    :local dis [/interface pppoe-client get $pc disabled]
    :if ($dis = true) do={
        :log warning ("KETQUA $nm = DISABLED (bo cuoc)")
    } else={
        :local ip [$getIp nm=$nm]
        :if ([:len $ip] = 0) do={ :set ip "khong co IP" }
        :log warning ("KETQUA $nm = $ip")
    }
}

}

/system scheduler remove [find name=schedule1]
/system scheduler remove [find name=quayip-scheduler]
/system scheduler add name=quayip-scheduler start-time=startup interval=5m \
    on-event="/system script run quayip" comment=webui-quayip-scheduler

:put "quayip: script + scheduler 5m (pppoe-wan excluded)"
