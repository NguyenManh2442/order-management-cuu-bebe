/** Máy chủ thường (npm run dev / npm start): một tiến trình phục vụ cả API lẫn giao diện. */
try {
  const { config } = await import('./config')
  const { createApp } = await import('./app')
  const { app, ghn } = createApp({ serveStatic: true })

  app.listen(config.port, () => {
    console.log(`API chạy tại http://localhost:${config.port} — nguồn dữ liệu: ${config.dataSource}`)
    if (config.demoLogin) console.log('Chế độ DEMO: đăng nhập bằng demo / demo. Dữ liệu chỉ nằm trong bộ nhớ.')
    const g = ghn.settings
    console.log(
      g
        ? `Giao Hàng Nhanh: ${g.env}, shop ${g.shop_id} (cấu hình từ ${ghn.source === 'file' ? config.ghn.settingsFile : '.env'})` +
            (g.webhook_secret ? ', webhook bật' : ', webhook tắt')
        : ghn.client
          ? 'Giao Hàng Nhanh: GIẢ LẬP (chưa thiết lập, không gọi GHN thật)'
          : 'Giao Hàng Nhanh: chưa thiết lập (vào "Thiết lập GHN" trong app)',
    )
  })
} catch (err) {
  // Lỗi cấu hình (.env sai/thiếu): in thông báo gọn rồi thoát thay vì in cả stack trace.
  console.error(`[config] ${(err as Error).message}`)
  process.exit(1)
}

export {}
