# LumaGrade

一款在浏览器本地运行的在线 LUT 修图工具。

## 功能

- 导入 JPG、PNG、WebP 图片
- 解析并应用标准 3D `.cube` LUT
- LUT 强度与基础曝光、色彩调节
- 实时 RGB 直方图
- 原图对比、撤销与重做
- 全分辨率 JPG 导出

照片与 LUT 仅在用户浏览器内处理，不会上传到服务器。

## 本地运行

```bash
npm install
npm run dev
```

## 部署

项目使用标准 Next.js，可直接导入 Vercel 部署。
