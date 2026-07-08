import {
  Modal, Form, Select, Input, Switch, Segmented, Typography,
} from 'antd';
import DismissibleAlert from '../ui/DismissibleAlert';
import type { ProxiesPageViewProps } from '../../hooks/useProxiesPage';

const { Text } = Typography;

type Props = Pick<
  ProxiesPageViewProps,
  | 'createOpen' | 'setCreateOpen' | 'createForm' | 'handleCreate' | 'pppoeOptions'
  | 'editTarget' | 'setEditTarget' | 'editForm' | 'handleEdit'
  | 'exportOpen' | 'setExportOpen' | 'exportForm' | 'handleExport'
  | 'credsOpen' | 'setCredsOpen' | 'credsMode' | 'setCredsMode' | 'credsForm' | 'credsText' | 'setCredsText'
  | 'credsBusy' | 'submitBulkCreds' | 'selected' | 'proxies'
  | 'importOpen' | 'setImportOpen' | 'importText' | 'setImportText' | 'handleImport'
>;

export default function ProxyModals({
  createOpen,
  setCreateOpen,
  createForm,
  handleCreate,
  pppoeOptions,
  editTarget,
  setEditTarget,
  editForm,
  handleEdit,
  exportOpen,
  setExportOpen,
  exportForm,
  handleExport,
  credsOpen,
  setCredsOpen,
  credsMode,
  setCredsMode,
  credsForm,
  credsText,
  setCredsText,
  credsBusy,
  submitBulkCreds,
  selected,
  proxies,
  importOpen,
  setImportOpen,
  importText,
  setImportText,
  handleImport,
}: Props) {
  return (
    <>
      <Modal title="Tạo proxy mới" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} okText="Tạo proxy" width={520}>
        <Form form={createForm} layout="vertical" onFinish={handleCreate} initialValues={{ proxyType: 'both' }}>
          <Form.Item name="pppoeIdx" label="PPPoE interface" rules={[{ required: true, message: 'Chọn PPPoE' }]}>
            <Select options={pppoeOptions} placeholder="Chọn pppoe-out (từ out1)" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="proxyType" label="Giao thức">
            <Select options={[
              { value: 'http', label: 'HTTP only' },
              { value: 'socks5', label: 'SOCKS5 only' },
              { value: 'both', label: 'HTTP + SOCKS5' },
            ]} />
          </Form.Item>
          <Form.Item name="username" label="Username (để trống = tự sinh)"><Input placeholder="vd: u1234" /></Form.Item>
          <Form.Item name="password" label="Password (để trống = tự sinh)"><Input.Password /></Form.Item>
          <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} maxLength={255} showCount /></Form.Item>
          <Text type="secondary">Container khởi tạo trong ~30–60 giây sau khi tạo.</Text>
        </Form>
      </Modal>

      <Modal title="Sửa proxy" open={!!editTarget} onCancel={() => setEditTarget(null)} onOk={() => editForm.submit()} okText="Lưu thay đổi">
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="proxyType" label="Loại">
            <Select options={[
              { value: 'http', label: 'HTTP only' },
              { value: 'socks5', label: 'SOCKS5 only' },
              { value: 'both', label: 'Both' },
            ]} />
          </Form.Item>
          <Form.Item name="username" label="Username"><Input /></Form.Item>
          <Form.Item name="password" label="Password (để trống = giữ nguyên)"><Input.Password /></Form.Item>
          <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} maxLength={255} showCount /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Export proxy" open={exportOpen} onCancel={() => setExportOpen(false)} onOk={() => exportForm.submit()} okText="Export" width={560}>
        <Form form={exportForm} layout="vertical" onFinish={handleExport} initialValues={{ format: 'ipportuserpass', fileFormat: '', includeSocks: false }}>
          <Form.Item name="format" label="Định dạng">
            <Select options={[
              { value: 'ipportuserpass', label: 'ip:port:user:pass' },
              { value: 'userpassipport', label: 'user:pass@ip:port' },
              { value: 'httpurl', label: 'http://user:pass@ip:port' },
              { value: 'socks5url', label: 'socks5://user:pass@ip:port' },
              { value: 'ipport', label: 'ip:port (no auth)' },
              { value: 'template', label: 'Template tuỳ biến' },
            ]} />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => exportForm.getFieldValue('format') === 'template' && (
              <Form.Item name="template" label="Template" tooltip="{scheme} {ip} {port} {user} {pass}">
                <Input placeholder="{scheme}://{user}:{pass}@{ip}:{port}" />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="includeSocks" valuePropName="checked">
            <Switch checkedChildren="Include SOCKS" unCheckedChildren="HTTP only" />
          </Form.Item>
          <Form.Item name="fileFormat" label="Output">
            <Select options={[
              { value: '', label: 'Copy clipboard' },
              { value: 'txt', label: 'Tải .txt' },
              { value: 'csv', label: 'Tải .csv' },
              { value: 'json', label: 'Tải .json' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Đổi user/pass hàng loạt"
        open={credsOpen}
        onCancel={() => setCredsOpen(false)}
        onOk={submitBulkCreds}
        okText="Áp dụng"
        confirmLoading={credsBusy}
        width={560}
      >
        <Segmented
          block
          style={{ marginBottom: 12 }}
          value={credsMode}
          onChange={v => setCredsMode(v as 'same' | 'lines')}
          options={[
            { value: 'same', label: 'Cùng user/pass' },
            { value: 'lines', label: 'Theo dòng' },
          ]}
        />
        {credsMode === 'same' ? (
          <>
            <DismissibleAlert
              bannerId="proxies-creds-same-scope"
              persist={false}
              type="info"
              showIcon
              message={selected.length > 0
                ? `Áp dụng cho ${selected.length} proxy đã chọn`
                : `Áp dụng cho tất cả ${proxies.length} proxy`}
              style={{ marginBottom: 12 }}
            />
            <Form form={credsForm} layout="vertical">
              <Form.Item
                name="username"
                label="Username mới"
                rules={[{
                  validator: (_, v) => !v?.trim() || /^[a-zA-Z0-9_-]{3,32}$/.test(v.trim())
                    ? Promise.resolve()
                    : Promise.reject(new Error('3–32 ký tự, chữ/số/_/-')),
                }]}
              >
                <Input placeholder="Để trống = giữ username cũ" />
              </Form.Item>
              <Form.Item
                name="password"
                label="Password mới"
                rules={[{
                  validator: (_, v) => !v?.trim() || (v.trim().length >= 6 && v.trim().length <= 64)
                    ? Promise.resolve()
                    : Promise.reject(new Error('6–64 ký tự')),
                }]}
              >
                <Input.Password placeholder="Để trống = giữ password cũ" />
              </Form.Item>
            </Form>
          </>
        ) : (
          <>
            <DismissibleAlert
              bannerId="proxies-creds-lines-format"
              type="info"
              showIcon
              message="Mỗi dòng: idx:user:pass hoặc pppoe-outN:user:pass"
              style={{ marginBottom: 12 }}
            />
            <Input.TextArea
              rows={10}
              value={credsText}
              onChange={e => setCredsText(e.target.value)}
              placeholder={'1:myuser1:secret12\npppoe-out2:myuser2:secret34\n3:client3:pass5678'}
            />
          </>
        )}
      </Modal>

      <Modal
        title="Import proxy hàng loạt"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={() => { if (importText.trim()) handleImport(importText); }}
        okText="Import"
        width={520}
      >
        <DismissibleAlert
          bannerId="proxies-import-format"
          type="info"
          showIcon
          message="Mỗi dòng = 1 pppoe idx (vd: 3) hoặc tên pppoe-out3"
          style={{ marginBottom: 12 }}
        />
        <Input.TextArea rows={10} value={importText} onChange={e => setImportText(e.target.value)} placeholder={'3\npppoe-out5\n11'} />
      </Modal>
    </>
  );
}