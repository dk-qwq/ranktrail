import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 单文件版：把 JS / CSS / 字体 / 内置榜单都内联进去，
// 产出 dist-single/RankTrail.html，双击就能用（可以直接发给别人）。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    license: { fileName: 'THIRD_PARTY_LICENSES.txt' },
    outDir: 'dist-single',
    emptyOutDir: true,
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
