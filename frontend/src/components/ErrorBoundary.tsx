// Error Boundary — bắt crash UI và hiển thị fallback
import React from 'react';
import { Result, Button } from 'antd';

interface Props { children: React.ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI crashed:', error, info);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="UI bị lỗi"
          subTitle={this.state.error.message}
          extra={[
            <Button key="reset" type="primary" onClick={this.reset}>Thử lại</Button>,
            <Button key="reload" onClick={() => location.reload()}>Reload trang</Button>,
          ]}
        />
      );
    }
    return this.props.children;
  }
}