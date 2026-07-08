const { spawnSync } = require('child_process');

function isWindows() {
  return process.platform === 'win32';
}

function isWindowsAdmin() {
  if (!isWindows()) return false;
  const r = spawnSync('net', ['session'], { shell: true, stdio: 'ignore' });
  return r.status === 0;
}

function assertWindowsSetup() {
  if (!isWindows()) {
    console.error('\nSETUP CHỈ HỖ TRỢ WINDOWS');
    console.error('Chạy trên PC Windows: setup.bat (chuột phải → Run as administrator)');
    console.error('Không hỗ trợ Linux / macOS / WSL cho setup 1-click.');
    process.exit(1);
  }
}

function assertWindowsAdmin() {
  assertWindowsSetup();
  if (!isWindowsAdmin()) {
    console.error('\nSETUP CẦN QUYỀN ADMINISTRATOR');
    console.error('Chuột phải setup.bat → Run as administrator');
    console.error('(setup.bat sẽ tự yêu cầu UAC nếu chạy double-click)');
    process.exit(1);
  }
}

module.exports = { isWindows, isWindowsAdmin, assertWindowsSetup, assertWindowsAdmin };