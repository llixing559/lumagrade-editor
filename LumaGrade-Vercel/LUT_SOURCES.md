# LumaGrade 内置 LUT 说明

内置预设统一为 33×33×33 三维 LUT，输入与输出均按 sRGB / Rec.709 显示空间处理。

## 数据表驱动的光谱模拟

以下 LUT 使用 Jan Lohse 的 MIT 许可项目
[`spectral_film_lut`](https://github.com/JanLohse/spectral_film_lut)
生成。该项目根据公开胶片数据表中的感光层光谱、特性曲线与印相材料建立多阶段模型。

- Kodak Portra 400 + Kodak Portra Endura Paper
- Kodak Gold 200 + Kodak Endura Premier Paper
- Kodak Vision3 250D 5207 + Kodak 2383 Print Film
- Kodak Tri-X 400 + Kodak Polymax Grade 2 Paper

主要原厂资料：

- [Kodak Portra 400 技术数据 E-4050](https://kodakprofessional.com/sites/default/files/2025-07/e4050.pdf)
- [Kodak Vision3 250D 技术数据](https://www.kodak.com/content/products-brochures/Film/VISION3-250D-Technical-Data-EN.pdf)
- [Kodak Tri-X 320/400 技术数据](https://kodakprofessional.com/sites/default/files/wysiwyg/film/f4017_trix_320400.pdf)

以上 v2 版本保留光谱模型产生的非线性色相响应，再针对普通照片显示空间重新校准黑白点、
饱和度和默认观感。它们仍是模拟结果，不是胶片扫描或 Kodak 官方 LUT。

## Fujifilm 官方 Film Simulation LUT

PROVIA、Velvia 和 Classic Chrome v2 使用 Fujifilm 官方公开的 33³
`F-Log2 → Film Simulation / BT.709` LUT 作为色彩核心：

- [Fujifilm 官方 3D-LUT 下载页](https://www.fujifilm-x.com/global/support/download/lut/)
- [F-Log2 Data Sheet Ver.1.1](https://dl.fujifilm-x.com/technical-data/F-Log2_DataSheet_E_Ver.1.1.pdf)

LumaGrade 先把 sRGB 解码到线性 Rec.709，再按照 Fujifilm 公布的 F-Gamut 原色坐标和
F-Log2 公式转换输入，最后应用官方 LUT。由于官方 LUT 面向视频，输出还进行了照片显示白点
归一化。这比依据文字描述手工拟合更接近富士的实际色相响应，但普通 JPEG 已经包含相机自身
的色调映射，因此仍不能宣称与富士机内 JPEG 逐像素一致。

## 官方样片校准的强化参考

Nostalgic Neg.、Hasselblad HNCS 和 Leica Classic 没有公开可验证、可直接用于普通
sRGB 照片的原厂通用 LUT。LumaGrade 没有冒充原厂文件，而是依据官方描述和官方样片，
在 Oklab 感知色彩空间中制作差异更明显的平滑参考 LUT：

- FUJI Nostalgic Neg.：琥珀色高光、丰富的暗部肤色和略微褪色的整体色彩。
- Hasselblad Natural+：暖肤、干净蓝调、丰富饱和度和更清晰的层次分离。
- Leica Classic+：高反差、柔和饱和度、暖色且略带褪色的电影感。

对应官方资料：

- [Fujifilm Nostalgic Neg.](https://www.fujifilm-x.com/global/products/film-simulation/nostalgic-neg/)
- [Hasselblad Natural Colour Solution](https://www.hasselblad.com/learn/hasselblad-natural-colour-solution/)
- [Leica Looks](https://leica-camera.com/en-US/photography/leica-looks)

这些参考 LUT 用于让普通 sRGB 照片接近相应审美，无法替代相机 RAW、传感器标定、
镜头光谱响应和原厂显影流程。
