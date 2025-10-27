const functions = require('firebase-functions/v1')
const admin = require('firebase-admin')

/** Gets the value of a Firebase reference. */
const get = refString =>
  new Promise((resolve, reject) => {
    const ref = admin.database().ref(refString)
    ref.once('value', snap => {
      resolve(snap.val())
    })
  })

/** Gets the value of a Firebase reference. */
const set = (refString, value) => admin.database().ref(refString).set(value)

/** Gets the value of a Firebase reference. */
const update = (refString, value) => admin.database().ref(refString).update(value)

const watchUsers = functions /*
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  /**/.auth
  .user()
  .onCreate(async user => {
    console.log(`New User: ${user.email} (${user.uid})`)

    const invites = await get('invites')
    const profile = await get(`users/${user.uid}/profile`)

    // get the invite code from the user profile
    // otherwise search for the invite by email
    const inviteCode =
      profile.code ||
      profile.codeNonBipoc ||
      Object.keys(invites).find(code => invites[code].email === user.email)

    const invite = invites[inviteCode]

    if (!inviteCode) {
      console.log('Regular user')
      return
    } else if (!invite) {
      console.error(`Missing invite record for invite code: ${inviteCode}`)
      return
    } else if (invite.used) {
      console.error(`Invite already used: ${inviteCode}`)
      return
    } else if (!invite.role || !invite.role.length) {
      console.error(`No role for invite code: ${inviteCode}`)
      return
    }
    // non-BIPOC contributor
    else if (invite.role === 'contributor' && !profile.bipoc) {
      console.log('Non-BIPOC contributor joining as ally')

      // add uid to invite
      // add signupEmail to invite if it differs from the invite email
      // mark invite as used
      await update(`invites/${inviteCode}`, {
        ...(user.email !== invite.email ? { signupEmail: user.email } : null),
        bipoc: profile.bipoc,
        uid: user.uid,
        used: new Date().toISOString(),
      })
      return
    }

    // set user role
    await set(`users/${user.uid}/roles`, { [invite.role]: true })

    // add uid to invite
    // add signupEmail to invite if it differs from the invite email
    // mark invite as used
    await update(`invites/${inviteCode}`, {
      ...(user.email !== invite.email ? { signupEmail: user.email } : null),
      uid: user.uid,
      used: new Date().toISOString(),
    })
  })

module.exports = watchUsers
