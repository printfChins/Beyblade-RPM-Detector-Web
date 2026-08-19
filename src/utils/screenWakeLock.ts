// [修改] 螢幕防休眠控制
// 一般瀏覽器使用標準 Screen Wake Lock API。
// Bluefy 額外使用 setScreenDimEnabled(false)，避免 iPhone / iPad 因閒置進入休眠。
// 頁面進入背景時恢復允許休眠，回到前景時再重新啟用防休眠。

type WakeLockSentinelLike = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
};

// [新增] Bluefy 專用 Bluetooth 擴充 API。
// Bluefy 3.8.2 起提供 bluetooth.setScreenDimEnabled(enabled)。
type BluefyBluetooth = {
  setScreenDimEnabled?: (enabled: boolean) => void | Promise<void>;
};

type BluefyNavigator = Navigator & {
  bluetooth?: BluefyBluetooth;
};

type BluefyGlobal = typeof globalThis & {
  bluetooth?: BluefyBluetooth;
};

let wakeLockSentinel: WakeLockSentinelLike | null = null;
let initialized = false;

// [新增] 取得 Bluefy 專用 Bluetooth API。
// 優先檢查 navigator.bluetooth，同時保留 global bluetooth 相容路徑。
function getBluefyBluetooth(): BluefyBluetooth | null {
  const navigatorBluetooth = (navigator as BluefyNavigator).bluetooth;

  if (typeof navigatorBluetooth?.setScreenDimEnabled === 'function') {
    return navigatorBluetooth;
  }

  const globalBluetooth = (globalThis as BluefyGlobal).bluetooth;

  if (typeof globalBluetooth?.setScreenDimEnabled === 'function') {
    return globalBluetooth;
  }

  return null;
}

// [新增] Bluefy 螢幕休眠控制。
// enabled = false：禁止螢幕因閒置變暗 / 休眠。
// enabled = true ：恢復 Bluefy / iOS 原本的螢幕休眠行為。
async function setBluefyScreenDimEnabled(enabled: boolean): Promise<void> {
  const bluetooth = getBluefyBluetooth();

  if (!bluetooth?.setScreenDimEnabled) {
    return;
  }

  try {
    await bluetooth.setScreenDimEnabled(enabled);
  } catch (error) {
    // [相容性]
    // Bluefy API 呼叫失敗時不影響 BLE、RPM 或其他網站功能。
    console.debug(
      '[ScreenWakeLock] Bluefy screen dim control rejected:',
      error,
    );
  }
}

async function requestScreenWakeLock(): Promise<void> {
  if (document.visibilityState !== 'visible' || wakeLockSentinel !== null) {
    return;
  }

  const wakeLock = (navigator as WakeLockNavigator).wakeLock;

  // [相容性] 舊版瀏覽器不支援 Screen Wake Lock API 時，
  // 不影響網站 BLE、RPM 或其他既有功能。
  if (!wakeLock) {
    return;
  }

  try {
    const sentinel = await wakeLock.request('screen');

    wakeLockSentinel = sentinel;

    sentinel.addEventListener(
      'release',
      () => {
        if (wakeLockSentinel === sentinel) {
          wakeLockSentinel = null;
        }
      },
      {once: true},
    );
  } catch (error) {
    // [相容性]
    // 瀏覽器、低耗電模式或權限狀態可能拒絕 Wake Lock。
    // 不拋出錯誤，後續回到前景或使用者操作時再次嘗試。
    console.debug(
      '[ScreenWakeLock] Wake Lock request rejected:',
      error,
    );
  }
}

// [修改] 統一啟用防休眠。
// Bluefy 使用原生擴充 API；支援標準 Wake Lock 的瀏覽器同時取得 screen lock。
function enableScreenWake(): void {
  void setBluefyScreenDimEnabled(false);
  void requestScreenWakeLock();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    // [修改] 從背景切回網頁後，同時恢復 Bluefy 與標準 Wake Lock。
    enableScreenWake();
    return;
  }

  // [新增] BRD 網頁不在前景時恢復允許螢幕休眠。
  void setBluefyScreenDimEnabled(true);
}

function handleUserInteraction(): void {
  // [修改]
  // 若瀏覽器首次開啟頁面時拒絕自動取得，
  // 在使用者觸控、滑鼠或鍵盤操作後再次嘗試。
  enableScreenWake();
}

function handlePageHide(): void {
  // [新增] 離開 / 關閉 BRD 網頁時恢復 Bluefy 原本的螢幕休眠設定。
  void setBluefyScreenDimEnabled(true);
}

export function initScreenWakeLock(): void {
  if (initialized) {
    return;
  }

  initialized = true;

  // [修改] 網頁開啟後同時嘗試 Bluefy 與標準 Screen Wake Lock。
  enableScreenWake();

  // [修改] App / 分頁前景與背景切換時同步更新防休眠狀態。
  document.addEventListener(
    'visibilitychange',
    handleVisibilityChange,
  );

  // [保留] 手機與電腦的使用者操作 fallback。
  window.addEventListener(
    'pointerdown',
    handleUserInteraction,
    {passive: true},
  );

  window.addEventListener(
    'touchstart',
    handleUserInteraction,
    {passive: true},
  );

  window.addEventListener(
    'keydown',
    handleUserInteraction,
  );

  // [新增] 關閉頁面、重新整理或離開頁面時恢復 Bluefy 螢幕休眠。
  window.addEventListener(
    'pagehide',
    handlePageHide,
  );
}
