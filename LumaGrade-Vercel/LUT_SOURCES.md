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
- Fujichrome Provia 100F
- Fujichrome Velvia 50

主要原厂资料：

- [Kodak Portra 400 技术数据 E-4050](https://kodakprofessional.com/sites/default/files/2025-07/e4050.pdf)
- [Kodak Vision3 250D 技术数据](https://www.kodak.com/content/products-brochures/Film/VISION3-250D-Technical-Data-EN.pdf)
- [Kodak Tri-X 320/400 技术数据](https://kodakprofessional.com/sites/default/files/wysiwyg/film/f4017_trix_320400.pdf)
- [Fujifilm Provia 官方说明](https://www.fujifilm-x.com/global/products/film-simulation/provia/)
- [Fujifilm Velvia 官方说明](https://www.fujifilm-x.com/global/products/film-simulation/velvia/)

## 官方样片与描述校准

以下产品使用专有色彩流程，没有公开可验证的原厂通用 LUT。LumaGrade 没有冒充原厂文件，
而是依据官方描述和官方样片，在 Oklab 感知色彩空间中制作平滑的参考 LUT：

- FUJI Classic Chrome：低饱和、压制洋红、偏冷且平静的阴影。
- FUJI Nostalgic Neg.：琥珀色高光、丰富的暗部肤色和略微褪色的整体色彩。
- Hasselblad Natural：自然准确、平滑层次、克制饱和度和稳定肤色。
- Leica Classic：高反差、柔和饱和度、暖色且略带褪色的电影感。

对应官方资料：

- [Fujifilm Classic Chrome](https://www.fujifilm-x.com/global/products/film-simulation/classic-chrome/)
- [Fujifilm Nostalgic Neg.](https://www.fujifilm-x.com/global/products/film-simulation/nostalgic-neg/)
- [Hasselblad Natural Colour Solution](https://www.hasselblad.com/learn/hasselblad-natural-colour-solution/)
- [Leica Looks](https://leica-camera.com/en-US/photography/leica-looks)

这些参考 LUT 用于让普通 sRGB 照片接近相应审美，无法替代相机 RAW、传感器标定、
镜头光谱响应和原厂显影流程。
