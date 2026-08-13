import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    /*
     * [新增]
     * GitHub Pages 專案網址：
     * https://printfchins.github.io/Beyblade-RPM-Detector-Web/
     *
     * 因此 Vite 靜態資源基礎路徑必須指定為 Repository 名稱。
     */
    base: '/Beyblade-RPM-Detector-Web/',

    plugins: [
      react(),
      tailwindcss(),
    ],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      /*
       * 原有設定保留。
       * AI Studio 可透過 DISABLE_HMR 環境變數停用 HMR。
       */
      hmr: process.env.DISABLE_HMR !== 'true',

      /*
       * 原有設定保留。
       * DISABLE_HMR=true 時停止檔案監控。
       */
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
