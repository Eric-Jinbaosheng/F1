import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'esnext',
    minify: 'terser',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: resolve(__dirname, 'dev.html'),
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
    terserOptions: {
      ecma: 2020,
      compress: {
        passes: 3,
        unsafe: true,
        unsafe_arrows: true,
        unsafe_math: true,
        drop_console: false,
        pure_getters: true,
      },
      mangle: { properties: { regex: /^_/ } },
      format: { comments: false },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5188,
    strictPort: true,
    open: 'http://localhost:5188/dev.html',
  },
})
