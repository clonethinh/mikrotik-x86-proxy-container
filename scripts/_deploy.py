"""Recreate webuiproxymikrotik container trên Mikrotik với code mới
- Dùng /container/env comma-separated syntax (RouterOS 7.23+)
"""
import paramiko, time

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('113.22.235.54', 22222, 'admin', 'toanthinh', timeout=12,
          banner_timeout=12, auth_timeout=12,
          allow_agent=False, look_for_keys=False)

def run(cmd, t=60):
    si, so, se = c.exec_command(cmd, timeout=t)
    out = so.read().decode(errors='replace')
    err = se.read().decode(errors='replace')
    if err.strip():
        print(f'STDERR ({cmd[:80]}...): {err[:200]}')
    return out, err

# 1. Stop + remove container cũ
print('=== STEP 1: Stop + remove old container ===')
run('/container/stop [find name=webuiproxymikrotik]')
time.sleep(5)
run('/container/remove [find name=webuiproxymikrotik]')
run(':do {/disk/remove [find name~"webuiproxymikrotik-root"]} on-error={}')
time.sleep(2)

# 2. Mount list
print('\n=== STEP 2: Mount list ===')
run(':do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}')
run('/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data')

# 3. Build env as comma-separated single value
envs = [
    'NODE_ENV=production',
    'PORT=8088',
    'MIKROTIK_HOST=172.17.0.1',
    'MIKROTIK_API_USER=admin',
    'MIKROTIK_API_PASS=toanthinh',
    'MIKROTIK_REST_PORT=80',
    'MIKROTIK_REST_SCHEME=http',
    'MIKROTIK_SSH_PORT=22222',
    'MIKROTIK_SSH_USER=admin',
    'MIKROTIK_SSH_PASS=toanthinh',
    'MIKROTIK_WAN_IP=113.22.235.54',
    'JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x',
    'ADMIN_USERNAME=admin',
    'ADMIN_PASSWORD=admin123',
    'DATABASE_URL=file:/data/proxy.db',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2',
    'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'THREEPROXY_HUB_IMAGE=webuiproxymikrotik/3proxy-hub:2',
    'THREEPROXY_HUB_TARBALL=disk1/3proxy-hub.tar',
    'PROXY_DEPLOY_MODE=hub',
    'HEALTH_CHECK_INTERVAL_MS=60000',
    'HEALTH_CHECK_TIMEOUT_MS=10000',
    'ENABLE_REALTIME=true',
    'LOG_LEVEL=info',
]
env_str = ','.join(envs)

# 4. Create container
print('\n=== STEP 3: Create container ===')
cmd = (f'/container/add file=disk1/webuiproxymikrotik.tar '
       f'interface=veth-webui root-dir=disk1/webuiproxymikrotik-root '
       f'name=webuiproxymikrotik mountlists=MOUNT_DATA logging=yes '
       f'start-on-boot=yes env="{env_str}"')
print(f'CMD len: {len(cmd)} chars')
out, err = run(cmd, t=60)
print(f'OUT: {out[:300]}')

# 5. Wait image extract
print('\n=== STEP 4: Wait 45s for image extract ===')
for i in range(9):
    time.sleep(5)
    si, so, se = c.exec_command('/container/print where name=webuiproxymikrotik', timeout=10)
    out = so.read().decode(errors='replace').strip()
    err = se.read().decode(errors='replace').strip()
    print(f'  t+{(i+1)*5}s: {out or "(empty)"}')
    if 'RUNNING' in out or 'HEALTHY' in out:
        break
    if 'FAILED' in out or err:
        print('  EXTRACT FAILED — check log')
        break

# 6. Start container (nếu chưa start)
print('\n=== STEP 5: Start container ===')
out, err = run('/container/start [find name=webuiproxymikrotik]')
print(f'OUT: {out}')

# 7. Wait backend boot
print('\n=== STEP 6: Wait 25s for backend boot ===')
time.sleep(25)
out, err = run('/container/print where name=webuiproxymikrotik')
print(out)

c.close()
print('\n=== DONE ===')