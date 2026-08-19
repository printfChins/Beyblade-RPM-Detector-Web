// [新增] 螢幕防休眠控制
// 使用標準 Screen Wake Lock API，避免頁面使用期間因閒置而自動關閉螢幕。
// Wake Lock 在頁面進入背景時會被瀏覽器釋放，因此 visibilitychange 回到前景時需重新取得。

type WakeLockSentinelLike = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
};

let wakeLockSentinel: WakeLockSentinelLike | null = null;
let initialized = false;

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

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    // [新增] 從背景切回網頁後重新取得 Wake Lock。
    void requestScreenWakeLock();
  }
}

function handleUserInteraction(): void {
  // [新增]
  // 若瀏覽器首次開啟頁面時拒絕自動取得，
  // 在使用者觸控、滑鼠或鍵盤操作後再次嘗試。
  void requestScreenWakeLock();
}

export function initScreenWakeLock(): void {
  if (initialized) {
    return;
  }

  initialized = true;

  // [新增] 網頁開啟後立即嘗試保持螢幕喚醒。
  void requestScreenWakeLock();

  // [新增] App / 分頁切回前景時重新取得。
  document.addEventListener(
    'visibilitychange',
    handleVisibilityChange,
  );

  // [新增] 手機與電腦的使用者操作 fallback。
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
}