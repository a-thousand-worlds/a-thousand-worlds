const admin = require('firebase-admin')
const functions = require('firebase-functions/v1')
const express = require('express')
const cors = require('cors')({ origin: true })
const serviceAccount = require('./serviceAccountKey.json')
// const nodemailer = require('nodemailer')
const sendEmail = require('./util/sendEmail')

/** Wraps a route handler in a try-catch statement that sends an error as a 500 response. */
const handleError = routeHandler => async (req, res) => {
  try {
    await routeHandler(req, res)
  } catch (err) {
    console.error(err)
    res.setHeader('content-type', 'text/plain')
    res.status(500)
    res.send(err.stack)
  }
}

module.exports = () => {
  const adminConfig = {
    ...JSON.parse(process.env.FIREBASE_CONFIG),
    credential: admin.credential.cert(serviceAccount),
  }
  admin.initializeApp(adminConfig)
  const app = express()
  app.use(cors)

  app.get(
    '/',
    handleError(async (req, res) => {
      const { to, body, replyTo, subject } = req.query

      if (!to || !body || !subject) {
        res
          .status(500)
          .send(
            'Insufficient query parameters. to, subject, and body are required. replyTo is optional.',
          )
        return
      }

      // can send emails to allowed_admin_emails without authorization
      const config = functions.config()
      const allowedRecipients = config.project.allowed_email_recipients || [
        config.project.admin_email,
      ]
      if (allowedRecipients.some(email => email.toLowerCase() === to.toLowerCase())) {
        const info = await sendEmail({ to, replyTo, subject, body })
        if (info.error) {
          console.log(`Sending email to <${to}> error: ${info.error}`)
          res.status(500).send(info.error)
          return
        }
        const id = info.messageId
        console.log(`Email sent: <${to}> ${subject} [${id}]`)
        res.status(200).json({ id })
        return
      }

      // if it's not to admin - authorization is required
      if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
        res.status(401).send('Not authorized.')
        return
      }

      const token = req.headers.authorization.split('Bearer ')[1]
      let user = null
      try {
        user = await admin.auth().verifyIdToken(token)
      } catch (err) {
        console.log('verifying token error', err)
        user = null
      }

      if (!user) {
        res.status(401).send('Not authorized.')
        return
      }

      admin
        .database()
        .ref(`users/${user.uid}/roles`)
        .once('value', async rolesSnap => {
          const roles = rolesSnap.val()

          // here is a point we testing user permission to send emails
          if (!roles || (!roles.owner && !roles.advisor && !roles.contributor && !roles.creator)) {
            console.log('user attempt to send email without permission!', user)
            res.status(403).send('Not authorized.')
            return
          }

          const info = await sendEmail({ to, subject, body })
          if (info.error) {
            console.log(`Sending email to <${to}> error: ${info.error}`)
            res.status(500).send(info.error)
            return
          }
          const id = info.messageId
          console.log(`Email sent: <${to}> ${subject} [${id}]`)
          res.status(200).json({ id })
        })
    }),
  )

  return app
}
