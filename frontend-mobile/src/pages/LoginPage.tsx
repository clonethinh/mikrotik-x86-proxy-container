import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Chip, Input, Label, Separator, TextField, toast } from '@heroui/react';
import { motion, useReducedMotion } from 'motion/react';
import { pageVariants, pageVariantsReduced, springSnappy } from '../lib/motion';
import Panel from '../components/ui/Panel';
import { useAuth } from '../services/auth';
import { isUiPreview } from '../lib/env';
import { IconServer } from '../components/ui/Icons';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [serverMsg, setServerMsg] = useState('');
  const reduce = useReducedMotion();

  useEffect(() => {
    if (isUiPreview) {
      navigate('/dashboard', { replace: true });
      return;
    }
    let cancelled = false;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        setServerOk(true);
        setServerMsg(`RouterOS WebUI · uptime ${Math.round(d.uptime || 0)}s`);
      })
      .catch((e) => {
        if (cancelled) return;
        setServerOk(false);
        setServerMsg(String(e));
      });
    return () => { cancelled = true; };
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.warning('Nhập username và password');
      return;
    }
    setLoading(true);
    const ok = await login(username.trim(), password);
    setLoading(false);
    if (ok) {
      toast.success('Đăng nhập thành công');
      navigate('/dashboard', { replace: true });
    } else {
      toast.danger('Sai username hoặc password');
    }
  };

  return (
    <motion.div
      className="mobile-login"
      variants={reduce ? pageVariantsReduced : pageVariants}
      initial="initial"
      animate="animate"
      transition={reduce ? { duration: 0.15 } : springSnappy}
    >
      <div className="mobile-login-brand">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15 text-accent shadow-lg shadow-accent/10">
          <IconServer className="h-8 w-8" />
        </div>
        <h1>MikroTik Proxy</h1>
        <p>Mobile Console · quản lý fleet & proxy</p>
      </div>

      <Panel glow>
        <Chip
          className="mb-4 w-full justify-start"
          color={serverOk === true ? 'success' : serverOk === false ? 'danger' : 'default'}
        >
          {serverOk === null ? 'Đang kiểm tra API…' : serverMsg}
        </Chip>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField isRequired name="username" value={username} onChange={setUsername}>
            <Label>Username</Label>
            <Input placeholder="admin" autoComplete="username" />
          </TextField>
          <TextField isRequired name="password" type="password" value={password} onChange={setPassword}>
            <Label>Password</Label>
            <Input placeholder="••••••••" autoComplete="current-password" />
          </TextField>
          <Button type="submit" className="w-full" size="lg" isPending={loading}>
            Đăng nhập
          </Button>
        </form>

        {serverOk === false ? (
          <div className="alert-banner mt-4">
            Backend chưa chạy? Dùng <code className="mobile-mono">npm run dev:remote</code> hoặc khởi động backend trên cổng 8088.
          </div>
        ) : null}

        <Separator className="my-4" />

        <p className="text-center text-xs text-muted">
          Giao diện desktop đầy đủ:{' '}
          <a href="/" className="font-semibold text-accent underline-offset-2 hover:underline">mở WebUI</a>
        </p>
      </Panel>
    </motion.div>
  );
}