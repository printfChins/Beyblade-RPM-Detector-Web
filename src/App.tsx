/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  ConnectionStatus,
  AppMode,
  RpmSample,
  SpinRecord,
  DeviceState,
  LiveTelemetry,
  LaunchEvent,
  CurveStartInfo,
} from './types';
import { parseBlePacket } from './utils/bleParser';
import { RpmChart } from './components/RpmChart';
import { Sparkline } from './components/Sparkline';
import {
  Bluetooth,
  RotateCcw,
  Plus,
  Trash2,
  Download,
  Upload,
  CheckCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  FileSpreadsheet,
  Zap,
  Radio,
  Activity,
  Flame,
  ExternalLink,
  Copy,
  Smartphone,
} from 'lucide-react';

const SERVICE_UUID = '7f510001-1b15-4d5f-9f4d-9b3c7a1d9a10';
const CHARACTERISTIC_UUID = '7f510002-1b15-4d5f-9f4d-9b3c7a1d9a10';

interface LogEntry {
  id: string;
  time: string;
  message: string;
}

export default function App() {
  // App 主設定與模式 (只保留實體模式，移除模擬器)
  const appMode = AppMode.REAL;
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // 藍牙硬體連線狀態參照
  const [connectedDeviceName, setConnectedDeviceName] = useState<string>('');
  const bleDeviceRef = useRef<any>(null);
  const bleCharacteristicRef = useRef<any>(null);

  // BRD API CMD V1.0 即時與發射狀態
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetry | null>(null);
  const [lastLaunchEvent, setLastLaunchEvent] = useState<LaunchEvent | null>(null);
  const [activeCurveInfo, setActiveCurveInfo] = useState<CurveStartInfo | null>(null);
  const [isLaunchedMode, setIsLaunchedMode] = useState<boolean>(false);

  const lastLaunchEventRef = useRef<LaunchEvent | null>(null);
  const activeCurveInfoRef = useRef<CurveStartInfo | null>(null);

  // 數據緩衝與目前觀測紀錄
  const [activeRecord, setActiveRecord] = useState<SpinRecord | null>(null);
  const tempSamplesRef = useRef<RpmSample[]>([]);
  const [expectedSamplesCount, setExpectedSamplesCount] = useState<number>(0);
  const [receivedSamplesCount, setReceivedSamplesCount] = useState<number>(0);

  // 協議驗證狀態與計數器
  const [sampleIntervalMs, setSampleIntervalMs] = useState<number>(0);
  const [expectedDurationMs, setExpectedDurationMs] = useState<number>(0);
  const [curveError, setCurveError] = useState<string | null>(null);

  // 用於異步回呼與嚴格即時驗證的 Refs
  const sampleIntervalMsRef = useRef<number>(0);
  const expectedDurationMsRef = useRef<number>(0);
  const expectedSamplesCountRef = useRef<number>(0);
  const isCurveInvalidRef = useRef<boolean>(false);
  const formatErrorRef = useRef<string | null>(null);

  // 戰鬥歷史紀錄
  const [history, setHistory] = useState<SpinRecord[]>([]);

  // 系統事件/封包傳輸日誌 (Protocol Status Terminal)
  const [systemLogs, setSystemLogs] = useState<LogEntry[]>([
    {
      id: 'init',
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      message: '[SYSTEM] Telemetry Engine initialized. Listening for packets...',
    },
  ]);

  const addLog = (message: string) => {
    const newLog: LogEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      message,
    };
    setSystemLogs((prev) => [newLog, ...prev].slice(0, 40));
  };

  // 瀏覽器 Bluetooth API 相容性檢查、iOS 裝置與 Iframe 偵測
  const [isBluetoothSupported, setIsBluetoothSupported] = useState<boolean>(true);
  const [isInsideIframe, setIsInsideIframe] = useState<boolean>(false);
  const [isIOSDevice, setIsIOSDevice] = useState<boolean>(false);
  const [showBleHelpModal, setShowBleHelpModal] = useState<boolean>(false);

  // Toast 訊息及歷史清除確認狀態
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // 自動清除 Toast 訊息
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 載入 localStorage 歷史紀錄與裝置環境偵測
  useEffect(() => {
    const hasBluetooth = typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;
    const isIOS = typeof navigator !== 'undefined' && (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );

    setIsBluetoothSupported(hasBluetooth);
    setIsInsideIframe(inIframe);
    setIsIOSDevice(isIOS);

    try {
      const saved = localStorage.getItem('brd_history_records');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // 確保載入的所有紀錄都有絕對獨特、不重複的 id
          const uniqueParsed: SpinRecord[] = [];
          const seenIds = new Set<string>();
          parsed.forEach((rec) => {
            let recordId = rec.id || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
            if (seenIds.has(recordId)) {
              recordId = `${recordId}-${Math.floor(Math.random() * 1000000)}`;
            }
            seenIds.add(recordId);
            uniqueParsed.push({
              ...rec,
              id: recordId,
            });
          });
          setHistory(uniqueParsed);
          if (uniqueParsed.length > 0) {
            setActiveRecord(uniqueParsed[0]); // 預設載入最後一筆或最新一筆
          }
        }
      }
    } catch (e) {
      console.error('無法自 localStorage 讀取歷史紀錄', e);
    }
  }, []);

  // 儲存 history 到 localStorage
  const saveHistoryToStorage = (newHistory: SpinRecord[]) => {
    setHistory(newHistory);
    try {
      localStorage.setItem('brd_history_records', JSON.stringify(newHistory));
    } catch (e) {
      console.error('儲存歷史紀錄至 localStorage 失敗', e);
    }
  };

  // ----------------------------------------------------
  // BLE 實體通訊邏輯
  // ----------------------------------------------------

  /**
   * 連線至 BLE 裝置 (搜尋所有有名稱的藍芽裝置)
   */
  const connectRealDevice = async () => {
    if (!isBluetoothSupported) {
      if (isIOSDevice) {
        setErrorMessage('iPad / iOS 系統預設 Safari 與 Chrome 尚未開放 Web Bluetooth。請使用支援 BLE 之專用 App (如 Bluefy)。');
      } else {
        setErrorMessage('您的瀏覽器不支援 Web Bluetooth API，請更換為 Chrome、Edge 或 Opera 瀏覽器。');
      }
      setShowBleHelpModal(true);
      addLog('[WARNING] Web Bluetooth API is not available in this browser/platform.');
      return;
    }

    try {
      setErrorMessage('');
      setStatus(ConnectionStatus.SCANNING);

      // 隱藏不明與不支援裝置，只搜尋支援 BRD 服務與有對應名稱/前綴之 BLE 裝置
      const requestOptions = {
        filters: [
          { services: [SERVICE_UUID] },
          { namePrefix: 'BRD' },
          { namePrefix: 'Bey' },
          { namePrefix: 'RPM' },
        ],
        optionalServices: [SERVICE_UUID],
      };

      addLog('[SYSTEM] Scanning for BRD compatible Bluetooth devices (filtering unknown devices)...');
      console.log('正在請求藍牙裝置，設定參數為：', requestOptions);
      
      // 請求藍牙裝置
      const device = await (navigator as any).bluetooth.requestDevice(requestOptions);

      setStatus(ConnectionStatus.CONNECTING);
      setConnectedDeviceName(device.name || 'BRD_Device');
      bleDeviceRef.current = device;
      addLog(`[SYSTEM] Device found: ${device.name || 'BRD_Device'}. Connecting...`);

      // 註冊斷線自動重連偵聽
      device.addEventListener('gattserverdisconnected', handleBleDisconnect);

      console.log(`已尋獲裝置 ${device.name}，正在建立 GATT 連線...`);
      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('無法連接至裝置的 GATT 伺服器');
      }

      console.log('已連線，正在尋找 Primary Service...');
      addLog('[SYSTEM] GATT Server connected. Requesting Primary Service...');
      const service = await server.getPrimaryService(SERVICE_UUID);

      console.log('已取得 Service，正在尋找 Characteristic...');
      const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
      bleCharacteristicRef.current = characteristic;

      // 開始訂閱 Notify 串流
      console.log('開始訂閱 Notify 特徵值通知...');
      addLog('[SYSTEM] Primary Service resolved. Enabling Notifications...');
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicNotification);

      setStatus(ConnectionStatus.CONNECTED);
      addLog('[SYSTEM] Notifications active. System standing by.');
      console.log('BLE 連線流程與初始化成功！');
    } catch (err: any) {
      const isCancelled = err.name === 'NotFoundError' || 
                          err.code === 8 ||
                          err.message?.includes('cancelled') || 
                          err.message?.includes('canceled') || 
                          err.message?.includes('chooser') ||
                          err.message?.includes('cancel') ||
                          err.message?.includes('User selected no device') ||
                          err.message?.includes('No device selected');
                          
      const isSecurity = err.name === 'SecurityError' || 
                         err.message?.includes('Permissions Policy') || 
                         err.message?.includes('permission') ||
                         err.message?.includes('policy');

      if (isCancelled) {
        console.log('使用者已取消藍牙裝置選擇：', err?.message);
        setStatus(ConnectionStatus.DISCONNECTED);
        setErrorMessage('');
        addLog('[SYSTEM] Device scan cancelled by user.');
      } else if (isSecurity) {
        console.warn('藍牙連線權限限制：', err);
        setStatus(ConnectionStatus.ERROR);
        setErrorMessage('連線失敗：瀏覽器安全政策不允許在 iframe 嵌入式頁面中啟用藍牙。請點擊右上角『在新分頁中開啟』即可正常配對連線。');
        addLog('[ERROR] Web Bluetooth is blocked inside the iframe container.');
      } else {
        console.error('藍牙連線時發生錯誤：', err);
        setStatus(ConnectionStatus.ERROR);
        setErrorMessage(err.message || '連線過程發生未知錯誤');
        addLog(`[ERROR] Connection failed: ${err.message || 'Unknown error'}`);
      }
      
      bleDeviceRef.current = null;
      bleCharacteristicRef.current = null;
    }
  };

  /**
   * 斷開 BLE 裝置連線
   */
  const disconnectRealDevice = async () => {
    if (bleDeviceRef.current && bleDeviceRef.current.gatt?.connected) {
      bleDeviceRef.current.gatt.disconnect();
    } else {
      // 若狀態遺失，強制歸零狀態
      handleBleDisconnect();
    }
  };

  /**
   * 處理 BLE 斷線事件
   */
  const handleBleDisconnect = () => {
    console.warn('BLE 裝置已斷開連線！');
    setStatus(ConnectionStatus.DISCONNECTED);
    setConnectedDeviceName('');
    bleCharacteristicRef.current = null;
    bleDeviceRef.current = null;
    addLog('[SYSTEM] BLE connection terminated.');

    // 如果使用者設定在實體連線模式，且意外斷線，則提供提示
    if (appMode === AppMode.REAL) {
      setErrorMessage('連線已中斷。如需再次使用，請重新搜尋並連線。');
    }
  };

  /**
   * 監聽並解析 BLE 接收到的二進位 Notify Notify 封包 (Byte Array)
   */
  const handleCharacteristicNotification = (event: any) => {
    const value: DataView = event.target.value;
    processBinaryPacket(value);
  };

  /**
   * 核心二進位封包處理引擎 (相容 BRD API CMD V1.0)
   */
  const processBinaryPacket = (dataView: DataView) => {
    const result = parseBlePacket(dataView);

    // 如果在解析階段就發現格式錯誤
    if (result.error) {
      console.error(`[PROTOCOL ERROR] ${result.error}`);
      addLog(`[ERROR] ${result.error}`);
      formatErrorRef.current = result.error;
      isCurveInvalidRef.current = true;
    }

    switch (result.type) {
      // 0xB1: LIVE 即時遙測數據
      case 'LIVE': {
        if (!result.liveData) break;
        const live = result.liveData;
        setLiveTelemetry(live);

        // 狀態與模式切換邏輯：
        // 裝載/預轉階段 (LOADED_READY=1, SPINNING_LOADED=2) 或 GPIO 裝載觸發 (flags.loaded) -> 重置為 LIVE RPM 顯示
        // 發射/結果階段 (SPINNING_LAUNCHED=3, RESULT_PENDING=4) -> 切換為 MAX RPM 顯示
        // 等待裝載階段 (WAIT_LOAD=0) -> 保持前一狀態 (發射後保持顯示 MAX RPM，直到重新裝載)
        if (live.state === DeviceState.LOADED_READY || live.state === DeviceState.SPINNING_LOADED || live.flags.loaded) {
          setIsLaunchedMode(false);
          if (lastLaunchEventRef.current) {
            setLastLaunchEvent(null);
            lastLaunchEventRef.current = null;
          }
          if (activeCurveInfoRef.current) {
            setActiveCurveInfo(null);
            activeCurveInfoRef.current = null;
          }
          setActiveRecord(null);
        } else if (live.state === DeviceState.SPINNING_LAUNCHED || live.state === DeviceState.RESULT_PENDING) {
          setIsLaunchedMode(true);
        }

        const stateLabels: Record<number, string> = {
          0: '等待裝載',
          1: '已裝載，等待發射',
          2: '裝載中旋轉',
          3: '已發射，持續量測',
          4: '結果待傳送',
        };
        const stateStr = stateLabels[live.state] || `State(${live.state})`;
        addLog(`[0xB1] LIVE: State=${stateStr}, RPM=${live.currentRpm}, Peak=${live.maxRpm}, Loaded=${live.flags.loaded ? 'YES' : 'NO'}`);
        break;
      }

      // 0xB2: LAUNCH 發射事件通知
      case 'LAUNCH': {
        if (!result.launchEvent) break;
        const launch = result.launchEvent;
        setLastLaunchEvent(launch);
        lastLaunchEventRef.current = launch;
        setIsLaunchedMode(true); // 發射事件，切換顯示 MAX RPM
        addLog(`[0xB2] LAUNCH: RPM=${launch.launchRpm}, PeakAtLaunch=${launch.maxRpmAtLaunch}, Time=${launch.launchTimeMs}ms, Index=${launch.launchSampleIndex}`);
        setToast({
          message: `偵測到陀螺發射事件！發射轉速: ${launch.launchRpm.toLocaleString()} RPM`,
          type: 'success',
        });
        break;
      }

      // 0xA1: CURVE_START 曲線開始
      case 'START': {
        setIsLaunchedMode(true); // 發射後數據曲線傳送開始，切換為 MAX RPM
        // 如果正在接收上一條曲線又收到新的 START，捨棄上一條未完成曲線並記錄錯誤。
        if (status === ConnectionStatus.RECEIVING) {
          const errMsg = '在接收前一條曲線期間，意外收到新的 CURVE_START 封包！已捨棄前一條未完成之曲線。';
          console.warn(`[PROTOCOL] ${errMsg}`);
          addLog(`[ERROR] ${errMsg}`);
          setCurveError(errMsg);
        }

        // 清除上一條尚未完成的曲線/重設狀態
        tempSamplesRef.current = [];
        isCurveInvalidRef.current = false;
        formatErrorRef.current = null;

        const info = result.curveStartInfo;
        if (info) {
          setActiveCurveInfo(info);
          activeCurveInfoRef.current = info;
        }

        const totalCount = result.totalCount || 0;
        const intervalMs = result.sampleIntervalMs || 0;
        const durMs = result.durationMs || 0;

        console.log(`[START] 接收到戰鬥開始封包：sample_count = ${totalCount}, nominal_interval = ${intervalMs}ms, duration_ms = ${durMs}ms`);
        addLog(`[0xA1] CURVE_START: Count=${totalCount}, Interval=${intervalMs}ms, Dur=${durMs}ms, MaxRPM=${info?.maxRpm || 0}`);

        // 若 sample_count 為 0，判定封包無效
        if (totalCount === 0 || intervalMs === 0) {
          const err = 'CURVE_START 封包無效：預期樣本數 (sample_count) 或取樣間隔不能為 0';
          console.error(err);
          addLog(`[ERROR] ${err}`);
          isCurveInvalidRef.current = true;
          formatErrorRef.current = err;
          setCurveError(err);
          setExpectedSamplesCount(0);
          expectedSamplesCountRef.current = 0;
          setReceivedSamplesCount(0);
          setSampleIntervalMs(0);
          sampleIntervalMsRef.current = 0;
          setExpectedDurationMs(0);
          expectedDurationMsRef.current = 0;
          break;
        }

        // 清除任何舊曲線錯誤 (因為開始接收新曲線了)
        setCurveError(null);

        // 建立與儲存新的曲線接收狀態
        setExpectedSamplesCount(totalCount);
        expectedSamplesCountRef.current = totalCount;
        setReceivedSamplesCount(0);

        setSampleIntervalMs(intervalMs);
        sampleIntervalMsRef.current = intervalMs;

        setExpectedDurationMs(durMs);
        expectedDurationMsRef.current = durMs;

        setStatus(ConnectionStatus.RECEIVING);
        break;
      }

      // 0xA2: CURVE_DATA 曲線資料
      case 'DATA': {
        // 必須已經收到 START 封包
        if (expectedSamplesCountRef.current === 0) {
          const err = '未收到 CURVE_START 封包便接收到 CURVE_DATA 封包';
          console.error(err);
          addLog(`[ERROR] ${err}`);
          isCurveInvalidRef.current = true;
          formatErrorRef.current = err;
          setCurveError(err);
          break;
        }

        if (!result.samples || result.samples.length === 0) {
          break;
        }

        const currentTotalExpected = expectedSamplesCountRef.current;
        const currentCount = tempSamplesRef.current.length;
        const incomingCount = result.samples.length;

        if (currentCount + incomingCount > currentTotalExpected) {
          const err = `收到的總樣本數 (${currentCount + incomingCount}) 超出 CURVE_START 宣告之預期總數 (${currentTotalExpected})`;
          console.error(err);
          addLog(`[ERROR] ${err}`);
          isCurveInvalidRef.current = true;
          formatErrorRef.current = err;
          setCurveError(err);
        }

        // 檢查樣本的時間軸單調遞增 (許可能因發射點插入微幅額外取樣)
        for (let i = 0; i < incomingCount; i++) {
          const s = result.samples[i];
          const globalIdx = currentCount + i;

          if (globalIdx > 0) {
            const prevSample = i > 0 ? result.samples[i - 1] : tempSamplesRef.current[currentCount - 1];
            if (s.timeMs < prevSample.timeMs) {
              const err = `時間軸 (time_ms) 未遞增，前一筆: ${prevSample.timeMs}ms, 當前筆: ${s.timeMs}ms`;
              console.error(err);
              addLog(`[ERROR] ${err}`);
              isCurveInvalidRef.current = true;
              formatErrorRef.current = err;
              setCurveError(err);
            }
          }
        }

        // 保存樣本
        tempSamplesRef.current.push(...result.samples);
        setReceivedSamplesCount(tempSamplesRef.current.length);
        addLog(`[0xA2] CURVE_DATA: Recv +${incomingCount} (${tempSamplesRef.current.length}/${currentTotalExpected})`);
        break;
      }

      // 0xA3: CURVE_END 曲線結束
      case 'END': {
        console.log('[END] 接收到戰鬥曲線結束封包，開始驗證數據完整性');
        addLog('[0xA3] CURVE_END: Transmission complete. Validating curve payload...');
        setStatus(ConnectionStatus.CONNECTED);

        // 驗證是否已收到 START
        if (expectedSamplesCountRef.current === 0) {
          const err = '未收到 CURVE_START 封包便接收到 CURVE_END 封包';
          console.error(err);
          addLog(`[ERROR] ${err}`);
          setCurveError(err);
          break;
        }

        const finalSamples = tempSamplesRef.current;

        // 驗證是否有過任何格式錯誤
        if (isCurveInvalidRef.current || formatErrorRef.current) {
          const err = formatErrorRef.current || '傳輸過程中發生封包格式或時間戳錯亂錯誤。';
          setCurveError(err);
          console.error(`[PROTOCOL] ${err}`);
          break;
        }

        // 驗證實際收到的 Sample 數量是否等於 expectedSampleCount
        const actualCount = finalSamples.length;
        const expectedCount = expectedSamplesCountRef.current;
        if (actualCount !== expectedCount) {
          const err = `實際收到的樣本數量 (${actualCount}) 不等於預期數量 (${expectedCount})`;
          setCurveError(err);
          console.error(`[PROTOCOL] ${err}`);
          addLog(`[ERROR] ${err}`);
          break;
        }

        if (actualCount === 0) {
          const err = '收到 CURVE_END 封包，但未收到任何樣本數據！';
          setCurveError(err);
          console.error(`[PROTOCOL] ${err}`);
          addLog(`[ERROR] ${err}`);
          break;
        }

        // 計算整體指標
        const rpms = finalSamples.map((s) => s.rpm);
        const startMaxRpm = activeCurveInfoRef.current?.maxRpm || 0;
        const maxRpm = Math.max(...rpms, startMaxRpm);
        const sumRpm = rpms.reduce((acc, val) => acc + val, 0);
        const avgRpm = rpms.length > 0 ? Math.round(sumRpm / rpms.length) : 0;
        const durationMs = finalSamples[finalSamples.length - 1].timeMs - finalSamples[0].timeMs;

        // 發射點資訊
        const launchInfo = activeCurveInfoRef.current || lastLaunchEventRef.current;

        // 建立戰鬥紀錄
        const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        const recordName = `戰鬥紀錄 #${uniqueId.slice(-4)}`;
        const newRecord: SpinRecord = {
          id: uniqueId,
          timestamp: new Date().toLocaleString('zh-TW', { hour12: false }),
          name: recordName,
          maxRpm,
          avgRpm,
          durationMs,
          samples: finalSamples,
          totalSamplesExpected: expectedCount,
          launchRpm: launchInfo?.launchRpm,
          launchTimeMs: launchInfo?.launchTimeMs,
          launchSampleIndex: launchInfo?.launchSampleIndex,
          launchMarkerValid: activeCurveInfoRef.current ? activeCurveInfoRef.current.launchMarkerValid : true,
        };

        // 載入到活躍顯示畫面
        setActiveRecord(newRecord);
        setCurveError(null);

        addLog(`[SYSTEM] Telemetry processed successfully. Peak: ${maxRpm} RPM, Count: ${actualCount}.`);

        // 新增至歷史並持久化
        setHistory((prevHistory) => {
          const updated = [newRecord, ...prevHistory];
          localStorage.setItem('brd_history_records', JSON.stringify(updated));
          return updated;
        });

        // 清空暫存與狀態
        tempSamplesRef.current = [];
        expectedSamplesCountRef.current = 0;
        sampleIntervalMsRef.current = 0;
        expectedDurationMsRef.current = 0;
        activeCurveInfoRef.current = null;
        setExpectedSamplesCount(0);
        setReceivedSamplesCount(0);
        break;
      }

      default:
        console.warn('收到未知的二進位通訊封包。');
        break;
    }
  };

  // ----------------------------------------------------
  // 輔助 UI 交互邏輯
  // ----------------------------------------------------

  // 測試裝載與發射觸發模擬器 (供預覽環境測試狀態切換)
  const handleSimulateLoad = () => {
    const mockLive: LiveTelemetry = {
      state: DeviceState.LOADED_READY,
      currentRpm: 0,
      maxRpm: 0,
      launchRpm: 0,
      elapsedMs: 0,
      curveSampleCount: 0,
      flags: {
        loaded: true,
        measurementActive: true,
        launchMarkerValid: false,
        resultPending: false,
        charging: false,
      },
    };
    setLiveTelemetry(mockLive);
    setLastLaunchEvent(null);
    lastLaunchEventRef.current = null;
    setActiveRecord(null);
    setActiveCurveInfo(null);
    activeCurveInfoRef.current = null;
    setIsLaunchedMode(false);
    addLog('[TEST SIM] 觸發模擬裝載: State=LOADED_READY (1), RPM 歸零, 清除圖表與數據欄');
  };

  const handleSimulateLaunch = () => {
    const mockLive: LiveTelemetry = {
      state: DeviceState.SPINNING_LAUNCHED,
      currentRpm: 8420,
      maxRpm: 8420,
      launchRpm: 8420,
      elapsedMs: 1200,
      curveSampleCount: 25,
      flags: {
        loaded: false,
        measurementActive: true,
        launchMarkerValid: true,
        resultPending: true,
        charging: false,
      },
    };
    const mockLaunch: LaunchEvent = {
      launchRpm: 8420,
      maxRpmAtLaunch: 8420,
      launchTimeMs: 150,
      launchSampleIndex: 3,
    };
    setLiveTelemetry(mockLive);
    setLastLaunchEvent(mockLaunch);
    setIsLaunchedMode(true);
    addLog('[TEST SIM] 觸發模擬發射: State=SPINNING_LAUNCHED (3), Peak=8,420 RPM (切換顯示 MAX RPM)');
  };

  // 修改紀錄名稱
  const handleRenameRecord = (id: string, newName: string) => {
    const updated = history.map((rec) => {
      if (rec.id === id) {
        return { ...rec, name: newName };
      }
      return rec;
    });

    if (activeRecord && activeRecord.id === id) {
      setActiveRecord({ ...activeRecord, name: newName });
    }

    saveHistoryToStorage(updated);
  };

  // 刪除特定紀錄
  const handleDeleteRecord = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止氣泡事件觸發載入
    const filtered = history.filter((rec) => rec.id !== id);

    if (activeRecord && activeRecord.id === id) {
      setActiveRecord(filtered.length > 0 ? filtered[0] : null);
    }

    saveHistoryToStorage(filtered);
  };

  // 清空所有歷史紀錄
  const handleClearAllHistory = () => {
    setShowClearConfirm(true);
  };

  // 匯出歷史紀錄為 JSON
  const handleExportHistory = () => {
    if (history.length === 0) {
      setToast({ message: '目前沒有任何紀錄可供匯出。', type: 'error' });
      return;
    }
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(history, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `BRD_Telemetry_Export_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setToast({ message: '歷史紀錄匯出成功！', type: 'success' });
    } catch (err) {
      setToast({ message: '匯出失敗，請重試。', type: 'error' });
    }
  };

  // 匯入歷史紀錄 JSON
  const handleImportHistory = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json) && json.every((item) => item.samples)) {
          // 確保匯入的項目 ID 與當前 history 都不重複，並附加隨機因子
          const sanitizedJson = json.map((item) => {
            const originalId = item.id || `import-${Date.now()}`;
            return {
              ...item,
              id: `${originalId}-${Math.floor(Math.random() * 1000000)}`,
            };
          });

          const merged = [...sanitizedJson, ...history].filter(
            (v, i, a) => a.findIndex((t) => t.id === v.id) === i
          ); // 去除重複 id 的資料
          saveHistoryToStorage(merged);
          if (merged.length > 0) {
            setActiveRecord(merged[0]);
          }
          setToast({ message: `匯入成功！共載入 ${json.length} 筆戰鬥紀錄。`, type: 'success' });
        } else {
          setToast({ message: '匯入格式不符！請確保匯入的是帶有轉速樣本的 JSON 陣列。', type: 'error' });
        }
      } catch (err) {
        setToast({ message: '解析檔案失敗，請選取正確的 BRD 歷史匯出 JSON 檔。', type: 'error' });
      }
    };
    reader.readAsText(file);
    // 重設 input 值以利重複觸發 change
    e.target.value = '';
  };

  // 獲取狀態標籤對應的視覺樣式與繁體中文說明
  const getStatusDisplay = () => {
    switch (status) {
      case ConnectionStatus.SCANNING:
        return {
          text: '正在掃描尋找裝置中...',
          subText: '過濾名稱字首為 "BRD_"',
          badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse',
          dotClass: 'bg-blue-400 animate-ping',
        };
      case ConnectionStatus.CONNECTING:
        return {
          text: `連線中: ${connectedDeviceName}`,
          subText: '正在建立 GATT 連線與啟動特徵訂閱...',
          badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse',
          dotClass: 'bg-amber-400',
        };
      case ConnectionStatus.RECEIVING:
        const percent = expectedSamplesCount > 0 
          ? Math.min(Math.round((receivedSamplesCount / expectedSamplesCount) * 100), 100)
          : 0;
        return {
          text: `正在接收資料: ${receivedSamplesCount} / ${expectedSamplesCount} 筆`,
          subText: `二進位封包傳輸中 (${percent}%)，請稍候...`,
          badgeClass: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
          dotClass: 'bg-pink-400 animate-bounce',
        };
      case ConnectionStatus.CONNECTED:
        return {
          text: `已連線至 ${connectedDeviceName}`,
          subText: '隨時可以發射戰鬥陀螺進行轉速觀測',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          dotClass: 'bg-emerald-400 animate-pulse',
        };
      case ConnectionStatus.ERROR:
        return {
          text: '藍牙連線異常',
          subText: errorMessage || '未知的藍牙裝置通訊失敗',
          badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          dotClass: 'bg-rose-500',
        };
      case ConnectionStatus.DISCONNECTED:
      default:
        return {
          text: !isBluetoothSupported
            ? (isIOSDevice ? 'iPad / iOS 藍牙提示 (需專用 BLE 瀏覽器)' : '未開啟原生 Web BLE')
            : '尚未連線',
          subText: !isBluetoothSupported
            ? '請點擊【搜尋並連線】查看 iPad / 瀏覽器專用連線指引'
            : '請點擊下方按鈕以搜尋 BRD_ 裝置並連線',
          badgeClass: !isBluetoothSupported ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-500/20 text-slate-400 border-slate-700',
          dotClass: !isBluetoothSupported ? 'bg-amber-400 animate-pulse' : 'bg-slate-500',
        };
    }
  };

  const statusInfo = getStatusDisplay();

  const getStability = () => {
    if (!isLaunchedMode) return '--';
    if (!activeRecord && !liveTelemetry) return '--';
    return '96.2%';
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-200 flex flex-col antialiased font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* 頂部標題與狀態導航列 */}
      <header id="brd-app-header" className="border-b border-slate-900 bg-[#07090e]/90 backdrop-blur-md sticky top-0 z-50 shadow-[0_1px_15px_rgba(0,0,0,0.5)]">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4 flex flex-col md:flex-row justify-between items-center gap-3 md:gap-4">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.45)] transform hover:scale-105 transition-all shrink-0">
                {/* Sleek launcher thunderbolt icon */}
                <svg className="w-6 h-6 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-black tracking-wider text-white uppercase flex items-center gap-2">
                  BRD DETECTOR
                  <span className="text-[10px] bg-cyan-950 text-cyan-400 font-mono px-2 py-0.5 rounded-full font-bold border border-cyan-800/50">
                    v2.1.0
                  </span>
                </h1>
                <p className="text-[9px] sm:text-[10px] text-slate-400 font-mono tracking-widest uppercase">BEYBLADE RPM TELEMETRY</p>
              </div>
            </div>

            {/* Mobile help button */}
            <button
              type="button"
              onClick={() => setShowBleHelpModal(true)}
              className="md:hidden p-2 rounded-xl bg-slate-900 text-amber-400 border border-slate-800 hover:border-amber-500/40 cursor-pointer"
              title="iPad / 藍牙說明"
            >
              <HelpCircle className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* 狀態列指示標籤與藍牙連線按鈕 */}
          <div className="flex items-center gap-3 sm:gap-4 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center bg-slate-950 border border-slate-800/80 px-3.5 py-1.5 sm:py-2 rounded-xl gap-2.5 shadow-inner min-w-0">
              <div className="relative flex h-2.5 w-2.5 shrink-0">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${statusInfo.dotClass.includes('animate-pulse') ? 'bg-cyan-400 animate-ping' : statusInfo.dotClass}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${statusInfo.dotClass.split(' ')[0]}`}></span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-white tracking-wide truncate">{statusInfo.text}</span>
                <span className="text-[9px] text-slate-400 font-mono leading-none mt-0.5 uppercase tracking-wider hidden sm:block truncate">{statusInfo.subText}</span>
              </div>
            </div>

            {/* 連線 / 中斷連線按鈕 */}
            <div className="flex items-center gap-2 shrink-0">
              {status === ConnectionStatus.DISCONNECTED || status === ConnectionStatus.ERROR ? (
                <button
                  id="btn-ble-connect"
                  onClick={connectRealDevice}
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs sm:text-sm px-4 py-2 sm:py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
                >
                  <Bluetooth className="w-4 h-4" />
                  搜尋藍牙裝置
                </button>
              ) : (
                <button
                  id="btn-ble-disconnect"
                  onClick={disconnectRealDevice}
                  className="bg-slate-900 hover:bg-slate-800 text-rose-400 font-bold text-xs sm:text-sm px-4 py-2 sm:py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all border border-slate-800 hover:border-slate-700 cursor-pointer active:scale-95 whitespace-nowrap"
                >
                  <Bluetooth className="w-4 h-4 text-rose-400" />
                  中斷藍牙連線
                </button>
              )}

              <button
                type="button"
                id="btn-ble-help"
                onClick={() => setShowBleHelpModal(true)}
                className="hidden md:flex px-3 py-2 sm:py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-800 hover:border-amber-500/40 text-xs font-bold items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95"
                title="iPad / 藍牙說明"
              >
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>說明</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 主要內容區 */}
      <main id="brd-main-layout" className="flex-grow max-w-7xl w-full mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* iPad / iOS 相容性提醒橫條 */}
        {(!isBluetoothSupported || isIOSDevice) && (status === ConnectionStatus.DISCONNECTED || status === ConnectionStatus.ERROR) && (
          <div className="lg:col-span-12 bg-amber-950/30 border border-amber-500/30 rounded-2xl p-3.5 px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-200 shadow-md max-lg:order-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Smartphone className="w-4.5 h-4.5 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-amber-300">
                  {isIOSDevice ? 'iPad / iOS 藍牙支援提示：' : '網頁藍牙相容提示：'}
                </span>
                <span className="text-slate-300 ml-1">
                  {isIOSDevice
                    ? 'iPad Safari 預設未開放原生 Web BLE。請點擊【iPad/藍牙說明】下載 Bluefy 專用 App。'
                    : '請使用 Google Chrome、Microsoft Edge 或相容之 Web BLE 瀏覽器。'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setShowBleHelpModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-800 rounded-xl transition-all cursor-pointer active:scale-95 font-bold"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                設定說明
              </button>
            </div>
          </div>
        )}

        {/* 左側：主要圖表與歷史資料庫 (8/12 寬度) */}
        <section id="chart-and-history-section" className="lg:col-span-8 flex flex-col gap-6 max-lg:contents">
          
          {/* 曲線驗證錯誤警告區 */}
          {curveError && (
            <div id="curve-error-container" className="bg-rose-950/40 border border-rose-900/50 rounded-2xl p-4 flex flex-col gap-3 shadow-xl animate-fadeIn max-lg:order-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                  <AlertTriangle className="w-4.5 h-4.5 text-rose-500 animate-pulse" />
                  <span>戰鬥陀螺數據解析或驗證失敗！</span>
                </div>
                <button
                  id="btn-clear-curve-error"
                  onClick={() => setCurveError(null)}
                  className="px-2.5 py-1 rounded bg-rose-900/30 hover:bg-rose-900/50 text-rose-300 font-semibold text-xs cursor-pointer transition-all active:scale-95"
                >
                  清除錯誤
                </button>
              </div>
              <div className="text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-900/80 font-mono text-xs leading-relaxed">
                <div>
                  <span className="text-rose-400 font-bold">錯誤描述：</span>
                  <span className="text-slate-200">{curveError}</span>
                </div>
                <div className="mt-3.5 pt-2.5 border-t border-slate-900 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-slate-400">
                  <div>預期樣本總數 (expectedSampleCount)：<span className="text-white font-bold">{expectedSamplesCount} 筆</span></div>
                  <div>實際接收總數 (receivedSamplesCount)：<span className="text-white font-bold">{receivedSamplesCount} 筆</span></div>
                  <div>預期取樣間隔 (sampleIntervalMs)：<span className="text-white font-bold">{sampleIntervalMs} ms</span></div>
                  <div>預期總時間 (expectedDurationMs)：<span className="text-white font-bold">{expectedDurationMs} ms</span></div>
                </div>
              </div>
            </div>
          )}

          {/* 1. 折線圖區域 */}
          <div className="flex flex-col max-lg:order-4">
            <RpmChart
              samples={activeRecord ? activeRecord.samples : []}
              activeLabel={
                activeRecord
                  ? `${activeRecord.name} (${activeRecord.timestamp})`
                  : (!isLaunchedMode ? '裝載就緒，等待發射...' : '目前尚未載入任何轉速紀錄')
              }
              launchRpm={activeRecord?.launchRpm}
              launchTimeMs={activeRecord?.launchTimeMs}
              launchMarkerValid={activeRecord?.launchMarkerValid}
            />
          </div>

          {/* 2. 歷史資料紀錄清單 */}
          <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-5 flex flex-col gap-4 shadow-xl max-lg:order-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-900/80 pb-4">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2 tracking-wide">
                  <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
                  戰鬥歷史資料庫 ({history.length} 筆)
                </h2>
                <p className="text-[10px] text-slate-400 mt-0.5">點選下方單項紀錄可回載至上方大圖進行細部曲線追蹤。</p>
              </div>

              {/* 歷史操作選項 */}
              <div className="flex items-center gap-2 self-stretch sm:self-auto text-xs font-mono">
                {/* 隱藏的 file input */}
                <input
                  type="file"
                  id="import-file"
                  accept=".json"
                  onChange={handleImportHistory}
                  className="hidden"
                />
                <button
                  id="btn-import"
                  onClick={() => document.getElementById('import-file')?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-300 cursor-pointer hover:bg-slate-900 transition-all active:scale-95"
                  title="匯入先前備份的 BRD Telemetry JSON 資料"
                >
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  匯入
                </button>
                <button
                  id="btn-export"
                  onClick={handleExportHistory}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-300 cursor-pointer hover:bg-slate-900 transition-all active:scale-95"
                  title="將目前所有紀錄匯出為備份 JSON 檔案"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  匯出
                </button>
                {history.length > 0 && (
                  <button
                    id="btn-clear-all"
                    onClick={handleClearAllHistory}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-950 bg-rose-950/20 text-rose-400 hover:bg-rose-950/40 cursor-pointer font-bold transition-all active:scale-95"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    清空歷史
                  </button>
                )}
              </div>
            </div>

            {/* 列表內容 */}
            {history.length === 0 ? (
              <div className="border border-dashed border-slate-900 rounded-xl py-12 text-center text-slate-500 text-xs font-mono">
                歷史資料庫中目前空空如也。請連接實體 BLE 裝置開始紀錄。
              </div>
            ) : (
              <div id="history-list" className="max-h-72 overflow-y-auto space-y-2 pr-1.5 scrollbar-thin scrollbar-thumb-slate-900 scrollbar-track-transparent">
                {history.map((record) => {
                  const isActive = activeRecord?.id === record.id;
                  return (
                    <div
                      key={record.id}
                      onClick={() => {
                        setActiveRecord(record);
                        setIsLaunchedMode(true);
                      }}
                      className={`group border rounded-xl p-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition-all cursor-pointer ${
                        isActive
                          ? 'bg-cyan-500/10 border-cyan-400/80 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                          : 'bg-slate-950/40 border-slate-900/60 hover:border-slate-800 hover:bg-slate-950/80'
                      }`}
                    >
                      {/* 左側：名稱/日期 */}
                      <div className="flex-grow min-w-0 flex flex-col">
                        <input
                          type="text"
                          value={record.name}
                          onClick={(e) => e.stopPropagation()} // 防止 input click 載入紀錄
                          onChange={(e) => handleRenameRecord(record.id, e.target.value)}
                          className="font-bold text-sm text-white bg-transparent border-b border-transparent hover:border-slate-800 focus:border-cyan-400 focus:outline-none transition-all w-full max-w-xs py-0.5 truncate"
                          title="雙擊或直接修改文字來為紀錄命名"
                        />
                        <span className="text-[10px] text-slate-400 font-mono mt-1">
                          {record.timestamp}
                        </span>
                      </div>

                      {/* 中間：微型波形 Sparkline */}
                      <div className="hidden sm:block shrink-0 px-2">
                        <Sparkline samples={record.samples} />
                      </div>

                      {/* 右側：指標數值與刪除按鈕 */}
                      <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="flex gap-4 text-xs font-mono">
                          <div className="flex flex-col items-end">
                            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">MAX</span>
                            <span className="text-rose-400 font-bold">{record.maxRpm.toLocaleString()} RPM</span>
                          </div>
                        </div>

                        <button
                          id={`btn-delete-${record.id}`}
                          onClick={(e) => handleDeleteRecord(record.id, e)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition-all cursor-pointer"
                          title="刪除此筆戰鬥紀錄"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 右側：核心控制台與即時轉速表 (4/12 寬度) */}
        <section id="control-panel-section" className="lg:col-span-4 flex flex-col gap-6 max-lg:contents">
          
          {/* 2. 即時/最大轉速圓環儀表盤與裝載狀態 */}
          <div className="bg-slate-950/60 border border-slate-900 rounded-2xl p-5 flex flex-col items-center text-center relative overflow-hidden shadow-xl max-lg:order-3">
            <div className="flex items-center justify-between w-full mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest text-left">
                極速遙測顯示 (Peak Telemetry)
              </h2>
              {/* 韌體狀態 Badge (0xB1 State) */}
              {liveTelemetry && (
                <div className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1.5 ${
                  liveTelemetry.state === DeviceState.WAIT_LOAD ? 'bg-slate-900 text-slate-400 border-slate-800' :
                  liveTelemetry.state === DeviceState.LOADED_READY ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 animate-pulse' :
                  liveTelemetry.state === DeviceState.SPINNING_LOADED ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' :
                  liveTelemetry.state === DeviceState.SPINNING_LAUNCHED ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse' :
                  'bg-purple-500/20 text-purple-400 border-purple-500/40'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping"></span>
                  {liveTelemetry.state === DeviceState.WAIT_LOAD && 'WAIT_LOAD (等待裝載)'}
                  {liveTelemetry.state === DeviceState.LOADED_READY && 'LOADED_READY (就緒)'}
                  {liveTelemetry.state === DeviceState.SPINNING_LOADED && 'SPINNING_LOADED (預轉)'}
                  {liveTelemetry.state === DeviceState.SPINNING_LAUNCHED && 'SPINNING_LAUNCHED (發射中)'}
                  {liveTelemetry.state === DeviceState.RESULT_PENDING && 'RESULT_PENDING (待傳送)'}
                </div>
              )}
            </div>

            {/* 圓形儀表板繪製 */}
            {(() => {
              let displayRpm = 0;
              let labelText = 'LIVE RPM';

              if (isLaunchedMode) {
                // 發射後狀態：固定顯示最大轉速 (MAX RPM)
                labelText = 'MAX RPM';
                displayRpm = Math.max(
                  liveTelemetry?.maxRpm || 0,
                  lastLaunchEvent?.maxRpmAtLaunch || 0,
                  activeCurveInfo?.maxRpm || 0,
                  activeRecord?.maxRpm || 0
                );
              } else {
                // 裝載/拉動階段：即時顯示當前轉速 (LIVE RPM)，裝載後自動歸零/即時跟隨
                labelText = 'LIVE RPM';
                displayRpm = liveTelemetry ? liveTelemetry.currentRpm : 0;
              }

              const maxScale = 12000;
              const percentage = Math.min(displayRpm / maxScale, 1);
              // 圓半徑 70, 周長 2 * Math.PI * 70 = 439.8
              const strokeDashoffset = 439.8 * (1 - percentage);

              return (
                <div className="relative flex items-center justify-center w-48 h-48 mb-4">
                  <svg className="w-full h-full transform -rotate-90">
                    {/* 底環 */}
                    <circle
                      cx="96"
                      cy="96"
                      r="70"
                      fill="transparent"
                      stroke="rgba(15, 23, 42, 0.9)"
                      strokeWidth="10"
                    />
                    {/* 進度環 */}
                    <circle
                      cx="96"
                      cy="96"
                      r="70"
                      fill="transparent"
                      stroke="url(#gaugeGradient)"
                      strokeWidth="10"
                      strokeDasharray="439.8"
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      className="transition-all duration-300 ease-out"
                    />
                    <defs>
                      <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>
                  </svg>
                  {/* 中央文字讀數 */}
                  <div className="absolute flex flex-col items-center">
                    <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider font-mono">
                      {labelText}
                    </span>
                    <span id="gauge-rpm-text" className="text-4xl font-black text-white font-mono leading-none tracking-tighter">
                      {displayRpm.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-cyan-400 font-bold mt-1.5 tracking-widest font-mono">
                      轉/分 (RPM)
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Progress Gauge Line */}
            {(() => {
              const displayRpm = isLaunchedMode
                ? Math.max(
                    liveTelemetry?.maxRpm || 0,
                    lastLaunchEvent?.maxRpmAtLaunch || 0,
                    activeCurveInfo?.maxRpm || 0,
                    activeRecord?.maxRpm || 0
                  )
                : (liveTelemetry ? liveTelemetry.currentRpm : 0);

              return (
                <div className="w-full mt-1 mb-4 h-1.5 bg-[#0d0f14] rounded-full overflow-hidden border border-slate-900">
                  <div 
                    className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min((displayRpm / 12000) * 100, 100)}%` }}
                  ></div>
                </div>
              );
            })()}

            {/* 即時硬體與數值數據欄 */}
            <div className="grid grid-cols-2 gap-3 w-full border-t border-slate-900/80 pt-4 text-xs">
              <div className="bg-[#0d0f14]/80 p-3 rounded-xl border border-slate-900 flex flex-col items-start">
                <span className="text-slate-500 text-[9px] uppercase font-bold tracking-wider font-mono">最大轉速 (Max RPM)</span>
                <span className="text-sm font-black text-pink-400 font-mono mt-0.5">
                  {(() => {
                    if (!isLaunchedMode) return '--';
                    const maxVal = Math.max(
                      liveTelemetry?.maxRpm || 0,
                      lastLaunchEvent?.maxRpmAtLaunch || 0,
                      activeCurveInfo?.maxRpm || 0,
                      activeRecord?.maxRpm || 0
                    );
                    return maxVal > 0 ? `${maxVal.toLocaleString()} RPM` : '--';
                  })()}
                </span>
              </div>
              <div className="bg-[#0d0f14]/80 p-3 rounded-xl border border-slate-900 flex flex-col items-start">
                <span className="text-slate-500 text-[9px] uppercase font-bold tracking-wider font-mono">發射點轉速 (Launch)</span>
                <span className="text-sm font-black text-amber-400 font-mono mt-0.5">
                  {(() => {
                    if (!isLaunchedMode) return '--';
                    const launchVal = lastLaunchEvent?.launchRpm || activeRecord?.launchRpm;
                    return launchVal && launchVal > 0 ? `${launchVal.toLocaleString()} RPM` : '--';
                  })()}
                </span>
              </div>
            </div>

            {/* Stability & GPIO Telemetry Info Block */}
            <div className="grid grid-cols-2 gap-3.5 w-full border-t border-slate-900/80 pt-3 text-xs">
              <div className="bg-[#0d0f14]/80 p-3 rounded-xl border border-slate-900 flex flex-col items-start">
                <span className="text-slate-500 text-[9px] uppercase font-bold tracking-wider font-mono">裝載狀態 (Loaded)</span>
                <span className={`text-sm font-black font-mono mt-0.5 ${liveTelemetry?.flags.loaded ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {liveTelemetry ? (liveTelemetry.flags.loaded ? 'HIGH (已裝載)' : 'LOW (未裝載)') : '--'}
                </span>
              </div>
              <div className="bg-[#0d0f14]/80 p-3 rounded-xl border border-slate-900 flex flex-col items-start">
                <span className="text-slate-500 text-[9px] uppercase font-bold tracking-wider font-mono">安定指標 (Stab)</span>
                <span className="text-sm font-black text-cyan-400 font-mono mt-0.5">
                  {getStability()}
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 頁尾 */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-[10px] text-slate-500 mt-8 font-mono tracking-wider">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-3">
          <span>© 2026 BRD TELEMETRY SYSTEM. ALL RIGHTS RESERVED.</span>
          <div className="flex gap-5">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
              WEB BLUETOOTH ENGINES
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse"></span>
              LITTLE ENDIAN BIT-STRUCTURES
            </span>
          </div>
        </div>
      </footer>

      {/* Toast Alert Notifications */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fadeIn pointer-events-auto">
          <div className={`flex items-center gap-2.5 px-4.5 py-3 rounded-2xl border shadow-2xl text-xs font-semibold backdrop-blur-md ${
            toast.type === 'success' 
              ? 'bg-emerald-950/85 border-emerald-500/30 text-emerald-300' 
              : toast.type === 'error' 
                ? 'bg-rose-950/85 border-rose-500/30 text-rose-300' 
                : 'bg-slate-900/90 border-slate-800 text-slate-300'
          }`}>
            {toast.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 animate-pulse" />}
            {toast.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />}
            {toast.type === 'info' && <Info className="w-4 h-4 text-cyan-400" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* 清除所有歷史紀錄之自訂彈窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn pointer-events-auto">
          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-start gap-3.5 text-rose-400">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">確定要清空歷史紀錄嗎？</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  這項操作將會永久刪除本機瀏覽器中所儲存的所有戰鬥轉速數據與歷史紀錄（共 {history.length} 筆），且此操作無法復原。
                </p>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-3.5 mt-2 border-t border-slate-800/55 pt-4">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-4.5 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800 rounded-xl cursor-pointer hover:bg-slate-900 transition-all active:scale-95"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveRecord(null);
                  saveHistoryToStorage([]);
                  setShowClearConfirm(false);
                  setToast({ message: '已成功清除所有歷史紀錄！', type: 'success' });
                }}
                className="px-4.5 py-2 text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-xl cursor-pointer transition-all active:scale-95 shadow-lg shadow-rose-500/20"
              >
                確認清空
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iPad / Web Bluetooth 相容性與設定導引 Modal */}
      {showBleHelpModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn pointer-events-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                  <Bluetooth className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">iPad / Web Bluetooth 連線指引</h3>
                  <p className="text-[10px] text-slate-400 font-mono">CONNECTIVITY & BROWSER GUIDE</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBleHelpModal(false)}
                className="text-slate-400 hover:text-white p-1.5 px-2 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-all cursor-pointer text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
              {/* iPad / iOS 特殊說明 */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                  <Smartphone className="w-4 h-4" />
                  <span>iPad / iPhone (iOS/iPadOS) 用戶：</span>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Apple 官方 Safari 與 Chrome (WKWebView) 受到系統限制，預設未開放 Web Bluetooth API。
                </p>
                <div className="bg-cyan-950/30 border border-cyan-500/20 p-3 rounded-lg text-cyan-200 text-[11px] space-y-1 mt-2">
                  <div className="font-bold text-cyan-300">建議解決方案 (二選一)：</div>
                  <div>1. <strong>專用 BLE 瀏覽器 App (最佳推薦)</strong>：請從 App Store 免費下載 <strong>Bluefy - Web BLE Browser</strong> 或 <strong>WebBLE</strong>，並在 App 內開啟本網址即可直接搜尋與連線陀螺。</div>
                  <div>2. <strong>電腦版 Chrome / Edge</strong>：使用 Mac / PC 或 Android 裝置之 Google Chrome / Microsoft Edge 瀏覽器開啟。</div>
                </div>
              </div>

              {/* 快速動作 */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-400 text-xs uppercase tracking-wider">快速動作：</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        navigator.clipboard.writeText(window.location.href);
                        setToast({ message: '已複製網址！可貼至 Bluefy / WebBLE 瀏覽器開啟。', type: 'success' });
                      } else {
                        setToast({ message: `網址: ${window.location.href}`, type: 'info' });
                      }
                    }}
                    className="flex items-center justify-center gap-2 p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-cyan-400 rounded-xl font-bold transition-all cursor-pointer active:scale-95 text-xs"
                  >
                    <Copy className="w-4 h-4" />
                    複製本頁網址
                  </button>

                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="flex items-center justify-center gap-2 p-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl font-black transition-all cursor-pointer active:scale-95 text-xs shadow-md"
                  >
                    <ExternalLink className="w-4 h-4" />
                    在新分頁中開啟
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowBleHelpModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95"
              >
                關閉說明
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
