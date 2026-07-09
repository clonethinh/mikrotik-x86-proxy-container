import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Drawer, Input, Label } from '@heroui/react';
import type { ProxyUser } from '../../services/api';
import { formatProxy, type ProxyFormat } from '../../lib/proxyUtils';

interface Props {
  proxy: ProxyUser | null;
  open: boolean;
  onClose: () => void;
  onCopy: (text: string, label?: string) => void;
  revealPassword: (id: number) => Promise<string>;
}

interface FormatRow {
  key: string;
  label: string;
  format: ProxyFormat;
  kind: 'http' | 'socks5';
}

const HTTP_FORMATS: FormatRow[] = [
  { key: 'httpurl', label: 'HTTP URL', format: 'httpurl', kind: 'http' },
  { key: 'ipportuserpass', label: 'ip:port:user:pass', format: 'ipportuserpass', kind: 'http' },
  { key: 'userpassipport', label: 'user:pass@ip:port', format: 'userpassipport', kind: 'http' },
  { key: 'ipport', label: 'ip:port', format: 'ipport', kind: 'http' },
];

const SOCKS_FORMATS: FormatRow[] = [
  { key: 'socks5url', label: 'SOCKS5 URL', format: 'socks5url', kind: 'socks5' },
  { key: 'ipportuserpass', label: 'ip:port:user:pass', format: 'ipportuserpass', kind: 'socks5' },
  { key: 'userpassipport', label: 'user:pass@ip:port', format: 'userpassipport', kind: 'socks5' },
  { key: 'ipport', label: 'ip:port', format: 'ipport', kind: 'socks5' },
];

function maskPassword(value: string, password: string, visible: boolean): string {
  if (visible || !password) return value;
  return value.split(password).join('••••••••');
}

function FormatLine({
  label,
  value,
  masked,
  onCopy,
}: {
  label: string;
  value: string;
  masked: string;
  onCopy: () => void;
}) {
  return (
    <div className="conn-drawer-line">
      <Label className="conn-drawer-line-label">{label}</Label>
      <div className="conn-drawer-line-row">
        <Input
          readOnly
          value={masked}
          className="conn-drawer-input mobile-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button size="sm" variant="secondary" isDisabled={!value} onPress={onCopy}>
          Copy
        </Button>
      </div>
    </div>
  );
}

export default function ProxyConnectionDrawer({
  proxy,
  open,
  onClose,
  onCopy,
  revealPassword,
}: Props) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!open || !proxy) {
      setPassword('');
      setError(null);
      setShowPassword(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (proxy.password) {
          if (!cancelled) setPassword(proxy.password);
          return;
        }
        const pw = await revealPassword(proxy.id);
        if (!cancelled) setPassword(pw);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Không lấy được password');
          setPassword('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [open, proxy?.id, proxy?.password, revealPassword]);

  const row = useMemo(() => {
    if (!proxy) return null;
    return {
      publicIp: proxy.publicIp,
      pppoeIdx: proxy.pppoeIdx,
      index: proxy.pppoeIdx,
      username: proxy.username,
      password,
      extHttpPort: proxy.extHttpPort,
      extSocksPort: proxy.extSocksPort,
      proxyType: proxy.proxyType,
    };
  }, [proxy, password]);

  const buildAllText = () => {
    if (!row) return '';
    const lines: string[] = [];
    if (proxy?.proxyType !== 'socks5') {
      for (const f of HTTP_FORMATS) {
        const v = formatProxy(row, f.kind, f.format);
        if (v) lines.push(v);
      }
    }
    if (proxy?.proxyType !== 'http') {
      for (const f of SOCKS_FORMATS) {
        const v = formatProxy(row, f.kind, f.format);
        if (v) lines.push(v);
      }
    }
    return lines.join('\n');
  };

  const renderSection = (title: string, color: 'accent' | 'danger', formats: FormatRow[]) => {
    if (!row) return null;
    const kind = formats[0].kind;
    const port = kind === 'http' ? row.extHttpPort : row.extSocksPort;
    if (!port) return null;

    return (
      <div className="conn-drawer-section">
        <div className="section-title mb-2">
          <span className="section-title-bar" />
          {title}
        </div>
        <Chip size="sm" color={color} className="mb-3 mobile-mono">
          {row.publicIp}:{port}
        </Chip>
        <div className="flex flex-col gap-3">
          {formats.map((f) => {
            const value = formatProxy(row, f.kind, f.format);
            return (
              <FormatLine
                key={`${kind}-${f.key}`}
                label={f.label}
                value={value}
                masked={maskPassword(value, password, showPassword)}
                onCopy={() => onCopy(value, `Đã copy ${f.label}`)}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const missingIp = !!(proxy && !proxy.publicIp);

  return (
    <Drawer isOpen={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Backdrop>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog className="max-h-[92vh]">
            <Drawer.Header>
              <Drawer.Heading>Connection URL</Drawer.Heading>
              {proxy ? (
                <p className="text-sm text-muted mt-1">{proxy.pppoeName} · {proxy.username}</p>
              ) : null}
            </Drawer.Header>
            <Drawer.Body className="overflow-y-auto">
              {loading ? (
                <div className="text-sm text-muted py-4">Đang tải credentials…</div>
              ) : (
                <>
                  {missingIp && (
                    <div className="mobile-alert mobile-alert-warning mb-4">
                      Chưa có IP public — client chưa kết nối được.
                    </div>
                  )}
                  {error ? (
                    <div className="mobile-alert mobile-alert-danger mb-4">{error}</div>
                  ) : null}
                  {!missingIp && proxy ? (
                    <>
                      {proxy.proxyType !== 'socks5' && renderSection('HTTP Proxy', 'accent', HTTP_FORMATS)}
                      {proxy.proxyType !== 'http' && renderSection('SOCKS5 Proxy', 'danger', SOCKS_FORMATS)}
                    </>
                  ) : null}
                </>
              )}
            </Drawer.Body>
            <Drawer.Footer className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button
                size="sm"
                variant="outline"
                isDisabled={!password || loading}
                onPress={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Ẩn pass' : 'Hiện pass'}
              </Button>
              <Button
                size="sm"
                isDisabled={loading || !!error || missingIp}
                onPress={() => onCopy(buildAllText(), 'Đã copy tất cả định dạng')}
              >
                Copy tất cả
              </Button>
              <Button size="sm" variant="tertiary" onPress={onClose}>Đóng</Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}