"""Upload .rsc scripts mới lên Mikrotik"""
import paramiko, os

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('113.22.235.54', 22222, 'admin', 'toanthinh', timeout=12,
          banner_timeout=12, auth_timeout=12,
          allow_agent=False, look_for_keys=False)

sftp = c.open_sftp()
src = 'C:/Users/PC/Desktop/webuiproxymikrotik/mikrotik'
dst = '/disk1/webuiproxymikrotik'

# Đảm bảo dir tồn tại
try:
    sftp.stat(dst)
except IOError:
    si, so, se = c.exec_command(f'/disk/add path={dst} type=directory', timeout=10)
    so.read(); se.read()
    print(f'Created {dst}')

# Xoá file cũ trong dir trên router
si, so, se = c.exec_command(':do {/file/remove [find name~"webuiproxymikrotik/"]} on-error={}', timeout=15)
out = so.read().decode(errors='replace')
err = se.read().decode(errors='replace')
print(f'Cleaned old: out={out!r} err={err!r}')

# Upload từng file
for fn in sorted(os.listdir(src)):
    local = os.path.join(src, fn)
    remote = f'{dst}/{fn}'
    if not os.path.isfile(local): continue
    print(f'Uploading {fn} ...', end=' ', flush=True)
    sftp.put(local, remote)
    s = sftp.stat(remote)
    print(f'{s.st_size} bytes')

sftp.close()

# Verify bằng /file/print
si, so, se = c.exec_command('/file/print where name~"webuiproxymikrotik"', timeout=15)
print('\n=== Remote files after upload ===')
print(so.read().decode(errors='replace'))

c.close()
print('\n=== DONE ===')