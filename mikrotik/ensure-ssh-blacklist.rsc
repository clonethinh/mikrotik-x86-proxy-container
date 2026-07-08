# ============================================================
# ensure-ssh-blacklist.rsc
# SSH brute-force → hub-scan-deny (dùng chung rule hub-rate-limit-scan-drop)
# Tích hợp WebUI — import qua ensure-router-scripts.rsc
# ============================================================

:local maxFail 5
:local strikeTimeout "15m"
:local denyTimeout "1d"

# Dọn rule drop riêng (phiên bản cũ) — giờ dùng hub-rate-limit-scan-drop
:do {/ip firewall filter remove [find comment=hub-ssh-blacklist-drop]} on-error={}
:do {/ip firewall filter remove [find comment=hub-ssh-blacklist-lan-ok]} on-error={}

/system script remove [find name=hub-ssh-blacklist]
/system script add dont-require-permissions=yes name=hub-ssh-blacklist owner=admin \
    policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
:global hubSshLastLogId
:local maxFail 5
:local strikeTimeout "15m"
:local denyTimeout "1d"

:if ([:typeof $hubSshLastLogId] = "nothing") do={
    :local ids [/log find]
    :if ([:len $ids] > 0) do={
        :set hubSshLastLogId [:pick $ids ([:len $ids] - 1)]
    } else={
        :set hubSshLastLogId 0
    }
}

:local maxId $hubSshLastLogId
:foreach i in=[/log find where message~"login failure" and message~"via ssh"] do={
    :if ($i > $hubSshLastLogId) do={
        :local msg [/log get $i message]
        :local pFrom [:find $msg " from "]
        :local pVia [:find $msg " via "]
        :if (($pFrom >= 0) and ($pVia > $pFrom)) do={
            :local ip [:pick $msg ($pFrom + 6) $pVia]
            :local skip false
            :if ([:len [/ip firewall address-list find where list=hub-lan address=$ip]] > 0) do={ :set skip true }
            :if ([:len [/ip firewall address-list find where list=dev-route-skip address=$ip]] > 0) do={ :set skip true }
            :if ([:len [/ip firewall address-list find where list=hub-ssh-whitelist address=$ip]] > 0) do={ :set skip true }
            :if ($skip = false) do={
                :local did [/ip firewall address-list find where list=hub-scan-deny address=$ip]
                :if ([:len $did] > 0) do={
                    /ip firewall address-list set $did timeout=$denyTimeout comment="ssh-brute"
                } else={
                    :local sid [/ip firewall address-list find where list=hub-ssh-strikes address=$ip]
                    :if ([:len $sid] = 0) do={
                        /ip firewall address-list add list=hub-ssh-strikes address=$ip comment="1" timeout=$strikeTimeout
                    } else={
                        :local cnt 1
                        :do { :set cnt [:tonum [/ip firewall address-list get $sid comment]] } on-error={ :set cnt 1 }
                        :set cnt ($cnt + 1)
                        :if ($cnt >= $maxFail) do={
                            /ip firewall address-list add list=hub-scan-deny address=$ip timeout=$denyTimeout comment="ssh-brute"
                            /ip firewall address-list remove $sid
                            :log warning ("hub-ssh-blacklist: blocked " . $ip . " via hub-scan-deny (" . $cnt . " failures)")
                        } else={
                            /ip firewall address-list set $sid comment=[:tostr $cnt] timeout=$strikeTimeout
                        }
                    }
                }
            }
        }
        :if ($i > $maxId) do={ :set maxId $i }
    }
}
:set hubSshLastLogId $maxId
}

/system scheduler remove [find name=hub-ssh-blacklist]
/system scheduler add name=hub-ssh-blacklist start-time=startup interval=1m \
    on-event="/system script run hub-ssh-blacklist"

:global hubSshLastLogId
:local bootIds [/log find]
:if ([:len $bootIds] > 0) do={
    :set hubSshLastLogId [:pick $bootIds ([:len $bootIds] - 1)]
} else={
    :set hubSshLastLogId 0
}

/system script run hub-ssh-blacklist
:put "ensure-ssh-blacklist: DONE (5 failures -> hub-scan-deny, drop via hub-rate-limit-scan-drop)"