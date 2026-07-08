# Setup proxy3p-3 manually on Mikrotik
# Run as: /import file=disk1/webuiproxymikrotik/setup-proxy3.rsc

:put "=== STEP 1: Write users-3.json ==="
:do {/file/remove [find name=disk1/users-3.json]} on-error={}
:local content "[{\"i\":3,\"ip\":\"\",\"user\":\"u003\",\"pass\":\"test1234\",\"enabled\":true}]"
/file/add name=disk1/users-3.json contents=$content
:put "users-3.json created:"
:put [/file/get [find name=disk1/users-3.json] contents]

:put ""
:put "=== STEP 2: Create 3proxy container ==="
:do {
    /container/add file=disk1/3proxy.tar \
        interface=veth-3p-3 \
        root-dir=disk1/3proxy-p3 \
        name=proxy3p-3 \
        mountlists=MOUNT_PROXY_3 \
        logging=yes
    :put "Container added"
} on-error={ :put "Container add FAILED, may already exist" }

:delay 35s

:put ""
:put "=== STEP 3: Status ==="
/container/print detail where name=proxy3p-3

:put ""
:put "=== STEP 4: Start if not running ==="
:local cInfo [/container/print as-value where name=proxy3p-3]
:local cStatus ($cInfo->"status")
:put ("Status: " . $cStatus)
:if ($cStatus != "running") do={
    /container/start [find name=proxy3p-3]
    :put "Started"
    :delay 5s
} else={
    :put "Already running"
}

:put ""
:put "=== STEP 5: Final status ==="
/container/print where name=proxy3p-3