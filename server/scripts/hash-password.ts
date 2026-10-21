import { hashPassword } from '../password'

const password = process.argv[2]
if (!password || password.length < 8) {
  console.error('Cách dùng: npm run hash-password -- <mật-khẩu ít nhất 8 ký tự>')
  process.exit(1)
}
console.log(hashPassword(password))
