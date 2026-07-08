"""Convert OCI image -> Docker v2 schema (gzip -> uncompressed tar)
RouterOS Container feature yêu cầu schema docker v2 cũ:
  - manifest.json: [Config, RepoTags, Layers]
  - repositories
  - <config-hash>.json
  - <layer-hash>.tar (UNCOMPRESSED)
"""
import tarfile, json, os, gzip, io

import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# In Docker, ROOT may differ; support env var override
if os.name == 'nt' or (len(sys.argv) > 1 and sys.argv[1]):
    # Windows or override arg
    base = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/PC/Desktop/webuiproxymikrotik'
else:
    # WSL/Linux
    base = '/mnt/c/Users/PC/Desktop/webuiproxymikrotik'
src = os.path.join(base, 'webuiproxymikrotik.tar')
dst = os.path.join(base, 'webuiproxymikrotik.docker.tar')

with tarfile.open(src, 'r') as t:
    idx = json.loads(t.extractfile('index.json').read().decode())
    oci_manifest = json.loads(t.extractfile('manifest.json').read().decode())[0]

config_ref = oci_manifest['Config']
layer_refs = oci_manifest['Layers']

with tarfile.open(src, 'r') as t:
    config_blob = t.extractfile(config_ref).read()
    layers_gzip = [t.extractfile(ld).read() for ld in layer_refs]

# Build docker v2 manifest
docker_manifest = [{
    'Config': config_ref.split('/')[-1] + '.json',
    'RepoTags': ['webuiproxymikrotik:latest'],
    'Layers': [],
}]
repositories = {'webuiproxymikrotik': {'latest': config_ref.split(':')[-1]}}

# Decompress layers
print(f'Config: {config_ref} ({len(config_blob)} bytes)')
print(f'Layers: {len(layers_gzip)}')
decompressed_layers = []
for i, (gzip_data, layer_ref) in enumerate(zip(layers_gzip, layer_refs)):
    try:
        decompressed = gzip.decompress(gzip_data)
    except Exception:
        decompressed = gzip_data  # already uncompressed
    print(f'  Layer {i+1}: {layer_ref} -> {len(decompressed)} bytes')
    decompressed_layers.append(decompressed)
    docker_manifest[0]['Layers'].append(layer_ref.split('/')[-1] + '.tar')

# Write new tar
with tarfile.open(dst, 'w') as out:
    # manifest.json
    info = tarfile.TarInfo('manifest.json')
    data = json.dumps(docker_manifest).encode()
    info.size = len(data)
    out.addfile(info, io.BytesIO(data))

    # repositories
    info = tarfile.TarInfo('repositories')
    data = json.dumps(repositories).encode()
    info.size = len(data)
    out.addfile(info, io.BytesIO(data))

    # config
    info = tarfile.TarInfo(config_ref.split('/')[-1] + '.json')
    info.size = len(config_blob)
    out.addfile(info, io.BytesIO(config_blob))

    # layers (decompressed)
    for layer_ref, decompressed in zip(layer_refs, decompressed_layers):
        info = tarfile.TarInfo(layer_ref.split('/')[-1] + '.tar')
        info.size = len(decompressed)
        out.addfile(info, io.BytesIO(decompressed))

src_size = os.path.getsize(src) / 1024 / 1024
dst_size = os.path.getsize(dst) / 1024 / 1024
print(f'\nOriginal OCI tar: {src_size:.1f} MiB')
print(f'Converted docker tar: {dst_size:.1f} MiB')
print(f'Output: {dst}')