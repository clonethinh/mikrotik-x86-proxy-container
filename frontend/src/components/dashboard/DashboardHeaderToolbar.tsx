import { Button, Segmented, Tooltip, theme } from 'antd';
import {
  CloudServerOutlined, GlobalOutlined, ReloadOutlined, SyncOutlined,
} from '@ant-design/icons';
import { POLL_INTERVAL_OPTIONS, type PollIntervalSec } from '../../hooks/usePollInterval';

interface Props {
  pollSec: PollIntervalSec;
  onPollSecChange: (sec: PollIntervalSec) => void;
  refreshing?: boolean;
  onRefresh: () => void;
  onWan: () => void;
  onFleet: () => void;
}

export default function DashboardHeaderToolbar({
  pollSec,
  onPollSecChange,
  refreshing,
  onRefresh,
  onWan,
  onFleet,
}: Props) {
  const { token } = theme.useToken();

  return (
    <div className="dashboard-header-toolbar">
      <div className="dashboard-header-toolbar__group dashboard-header-toolbar__refresh">
        <Tooltip title="Tự động làm mới dashboard">
          <span className="dashboard-header-toolbar__sync" aria-hidden>
            <SyncOutlined spin={refreshing} style={{ color: token.colorPrimary, fontSize: 14 }} />
          </span>
        </Tooltip>
        <Segmented
          size="small"
          className="dashboard-header-toolbar__segmented"
          value={pollSec}
          onChange={v => onPollSecChange(v as PollIntervalSec)}
          options={POLL_INTERVAL_OPTIONS.map(s => ({ label: `${s}s`, value: s }))}
        />
        <Tooltip title="Làm mới ngay">
          <Button
            type="text"
            size="small"
            className="dashboard-header-toolbar__refresh-btn"
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={onRefresh}
          />
        </Tooltip>
      </div>

      <div className="dashboard-header-toolbar__sep" aria-hidden />

      <div className="dashboard-header-toolbar__group dashboard-header-toolbar__nav">
        <Tooltip title="Quản lý PPPoE WAN">
          <Button
            size="small"
            className="dashboard-header-toolbar__nav-btn"
            icon={<GlobalOutlined />}
            onClick={onWan}
          >
            WAN
          </Button>
        </Tooltip>
        <Tooltip title="Proxy Fleet — bảng điều khiển proxy">
          <Button
            size="small"
            type="primary"
            className="dashboard-header-toolbar__fleet-btn"
            icon={<CloudServerOutlined />}
            onClick={onFleet}
          >
            Fleet
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}