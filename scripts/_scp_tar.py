"""SCP docker-schema tar lên Mikrotik"""
import paramiko, os

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('113.22.235.54', 22222, 'admin', 'toanthinh', timeout=12,
          banner_timeout=12, auth_timeout=12,
          allow_agent=False, look_for_keys=False)

# Xoá tar cũ
si, so, se = c.exec_command(':do {/file/remove [find name~"webuiproxymikrotik.tar"]} on-error={}', timeout=20)
print(f'Cleaned: out={so.read().decode()!r}')

sftp = c.open_sftp()
local = 'C:/Users/PC/Desktop/webuiproxymikrotik/webuiproxymikrotik.docker.tar'
remote = '/disk1/webuiproxymikrotik.tar'
print(f'Uploading {local} ({os.path.getsize(local)/1024/1024:.1f} MiB) -> {remote}')
print('Progress: ', end='', flush=True)
def cb(transferred, total):
    pct = int(transferred * 100 / total)
    if pct % 10 == 0: print(f'{pct}% ', end='', flush=True)
sftp.put(local, remote, callback=cb)
print(' 100%')

s = sftp.stat(remote)
print(f'Uploaded: {s.st_size/1024/1024:.1f} MiB')
sftp.close()
c.close()