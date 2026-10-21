export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError(404, `Không tìm thấy ${what}`)

export const conflict = (what: string) =>
  new AppError(409, `${what} vừa được người khác cập nhật. Vui lòng tải lại để xem thay đổi mới nhất.`)
