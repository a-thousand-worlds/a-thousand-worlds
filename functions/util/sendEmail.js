const functions = require('firebase-functions/v1')
const nodemailer = require('nodemailer')

const sendEmail = async ({ to, replyTo, subject, body }) => {
  const mg = functions.config().mailgun
  const transporter = nodemailer.createTransport({
    host: 'smtp.mailgun.org',
    port: 2525,
    auth: {
      user: mg.user,
      pass: mg.password,
    },
  })

  let info = {
    error: null,
  }
  try {
    const args = {
      from: mg.sender,
      ...(replyTo ? { replyTo } : null),
      to,
      subject,
      html: body,
    }
    info = await transporter.sendMail(args)
  } catch (error) {
    info.error = error
  }
  return info
}

module.exports = sendEmail
