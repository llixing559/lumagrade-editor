# LumaGrade

一款在浏览器本地运行的在线 LUT 修图工具。

## 功能

- 导入 JPG、PNG、WebP 图片
- 10 款经过资料研究与样片校准的内置 33³ LUT
- 解析并应用用户自己的标准 3D `.cube` LUT
- 内置预设强度、用户 LUT 强度与基础曝光、色彩调节
- 实时 RGB 直方图
- 原图对比、撤销与重做
- 全分辨率 JPG 导出

内置预设包含 Portra 400、Gold 200、Vision3 250D、Provia 100F、
Velvia 50、FUJI CC、FUJI NC、Hasselblad、Leica Classic 和 Tri-X 400。
胶片预设采用公开数据表驱动的光谱模拟；专有相机色彩采用官方描述和官方样片校准的参考 LUT。
PROVIA、Velvia 和 Classic Chrome 使用 Fujifilm 官方 F-Log2 Film Simulation LUT
转换并适配普通 sRGB 照片。
详细依据与边界说明见 [LUT_SOURCES.md](./LUT_SOURCES.md)。

照片和 LUT 均在用户浏览器内处理，照片不会上传到服务器。

## 本地运行

```bash
npm install
npm run dev
```

## 部署

项目使用标准 Next.js，可直接导入 Vercel 部署。
