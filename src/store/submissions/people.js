import pick from 'lodash/pick'

import managed from '@/store/modules/managed'
import personSubmission from '@/store/constants/personSubmission'
import iam from '@/util/iam'
import mergeOne from '@/util/mergeOne'
import renderPerson from '@/util/renderPerson'
import sendEmail from '@/util/sendEmail'
import uid from '@/util/chronouid'

const module = mergeOne(managed('submits/people'), {
  actions: {
    /** Submit people form to Firebase */
    submit: async (context, submission) => {
      const profile = context.rootState.user.user.profile
      const id = uid()
      const submissionApprovable = {
        ...submission,
        id,
        reviewComment: '',
        status: 'pending',
        type: 'people',
      }

      // save people submission
      context.commit('setOne', { path: id, value: submissionApprovable })
      await context.dispatch('save', { path: id, value: submissionApprovable })

      // save submission id to user profile
      const profileNew = {
        ...profile,
        draftPerson: null,
        submissions: {
          ...profile.submissions,
          [id]: 'pending',
        },
      }
      await context.dispatch('user/saveProfile', profileNew, { root: true })

      // auto approve submission by owner
      if (iam(context.rootState, 'owner')) {
        // approvePerson depends on sub.createdBy
        // submissionApprovable does not have createdBy
        // get the submission from the store now that it has been saved by the collection and it will have createdBy
        const submissionCreated = context.getters.get(id)
        await context.dispatch('approvePerson', submissionCreated)
      } else {
        // notify owner
        try {
          const emailTemplatePath = 'email/submissions/pending/people'
          const emailTemplate = context.rootGetters['content/get'](emailTemplatePath)

          if (!emailTemplate || !emailTemplate.subject || !emailTemplate.body) {
            const message = `No email template at content/${emailTemplatePath}`
            console.error(message, profile)
            throw new Error(message)
          }

          const newPerson = renderPerson(profileNew, submission)

          const fullName = profile.name || 'friend'
          const firstName = fullName.includes(' ')
            ? fullName.slice(0, fullName.indexOf(' '))
            : fullName
          const lastName = fullName.includes(' ') ? fullName.slice(fullName.indexOf(' ') + 1) : ''

          // sending email
          await sendEmail({
            to: process.env.VUE_APP_ADMIN_EMAIL,
            subject: emailTemplate.subject,
            data: {
              FIRST_NAME: firstName,
              LAST_NAME: lastName,
              FULL_NAME: fullName,
              NEW_PERSON: newPerson,
            },
            body: `<html>
          <head>
            <style>
              p { margin: 0; }
            </style>
          </head>
          <body>
            ${emailTemplate.body}
          </body>
        </html>`,
          })
        } catch (e) {
          console.error('Email failed to send')
          console.error(e)
        }
      }
    },

    /** Update submission status */
    updateSubmission: async (context, { personId, sub, status }) => {
      const submissionUpdates = {
        reviewedBy: context.rootState.user.user.uid,
        reviewedAt: new Date().toISOString(),
        status,
        ...(personId ? { personId } : null),
      }

      // commit local person submission update so we don't have to wait for server
      context.commit('setOne', {
        path: sub.id,
        value: {
          ...sub,
          ...submissionUpdates,
        },
      })

      // update person submission
      await context.dispatch('update', {
        path: sub.id,
        value: submissionUpdates,
      })

      // update user profile submission
      await context.dispatch(
        'users/save',
        {
          path: `${sub.createdBy}/profile/submissions/${sub.id}`,
          value: status,
        },
        { root: true },
      )

      // update user profile personId
      if (personId) {
        await context.dispatch(
          'users/save',
          {
            path: `${sub.createdBy}/profile/personId`,
            value: personId,
          },
          { root: true },
        )
      }
    },

    /** Rejects a submission. */
    async reject(context, sub) {
      await context.dispatch('updateSubmission', { sub, status: 'rejected' })

      // send email
      const submitter = await context.dispatch('users/loadOne', sub.createdBy, { root: true })
      if (!submitter) {
        const message = `Could not find user ${sub.createdBy} for submission ${sub.id}`
        console.error(message, sub)
        throw new Error(message)
      }
      if (!submitter.profile.email) {
        const message = `No email for user ${sub.createdBy} of submission ${sub.id}`
        console.error(message, sub)
        throw new Error(message)
      }

      const emailTemplatePath = 'email/submissions/rejected/people'
      const emailTemplate = context.rootGetters['content/get'](emailTemplatePath)

      if (!emailTemplate || !emailTemplate.subject || !emailTemplate.body) {
        const message = `No email template at ${emailTemplatePath}`
        console.error(message, sub)
        throw new Error(message)
      }

      const fullName = submitter.profile.name || 'friend'
      const firstName = fullName.includes(' ') ? fullName.slice(0, fullName.indexOf(' ')) : fullName
      const lastName = fullName.includes(' ') ? fullName.slice(fullName.indexOf(' ') + 1) : ''

      // sending email
      await sendEmail({
        to: submitter.profile.email,
        subject: emailTemplate.subject,
        data: {
          FIRST_NAME: firstName,
          LAST_NAME: lastName,
          FULL_NAME: fullName,
          NEW_PERSON: '',
        },
        body: `<html>
          <head>
            <style>
              p { margin: 0; }
            </style>
          </head>
          <body>
            ${emailTemplate.body}
          </body>
        </html>`,
      })
    },

    /** Approves submissions group */
    approve: (context, subs) => {
      return subs.map(sub => context.dispatch('approvePerson', sub))
    },

    /** Approves a single person. */
    approvePerson: async (context, sub) => {
      // find associated person by sub.personId, which PeopleSubmissionForm stamps from user.profile.personId
      // never match by name: a creator who renamed themselves would get a duplicate person record
      const person = sub.personId && context.rootGetters['people/get'](sub.personId)
      const personId = sub.personId || uid()
      const personNew = {
        ...person,
        ...pick(sub, Object.keys(personSubmission())),
        id: personId,
      }

      // if submission contains photo - we resaving it to separate file related with creator record
      // submission photo file may be removed if submission record is removed, and we don't want to lose photo file
      // we use 'donwloadUrl' field as mark for backend function to resave file from provided url
      if (sub.photo?.url?.startsWith('http')) {
        personNew.photo = {
          downloadUrl: sub.photo.url,
        }
      }

      // update user submission and people submission
      await context.dispatch('updateSubmission', {
        personId,
        sub,
        status: 'approved',
      })

      // save creator
      await context.dispatch(
        'people/save',
        {
          path: personId,
          value: personNew,
        },
        { root: true },
      )

      // send email
      const submitter = await context.dispatch('users/loadOne', sub.createdBy, { root: true })
      if (!submitter) {
        const message = `Could not find user ${sub.createdBy} for submission ${sub.id}`
        console.error(message, sub)
        throw new Error(message)
      }
      if (!submitter.profile.email) {
        const message = `No email for user ${sub.createdBy} of submission ${sub.id}`
        console.error(message, sub)
        throw new Error(message)
      }
      const newPerson = renderPerson(personNew, sub)

      const emailTemplatePath = 'email/submissions/approved/people'
      const emailTemplate = context.rootGetters['content/get'](emailTemplatePath)

      if (!emailTemplate || !emailTemplate.subject || !emailTemplate.body) {
        const message = `No email template at content/${emailTemplatePath}`
        console.error(message, personNew)
        throw new Error(message)
      }

      const fullName = submitter.profile.name || 'friend'
      const firstName = fullName.includes(' ') ? fullName.slice(0, fullName.indexOf(' ')) : fullName
      const lastName = fullName.includes(' ') ? fullName.slice(fullName.indexOf(' ') + 1) : ''

      // sending email
      await sendEmail({
        to: submitter.profile.email,
        subject: emailTemplate.subject,
        data: {
          FIRST_NAME: firstName,
          LAST_NAME: lastName,
          FULL_NAME: fullName,
          NEW_PERSON: newPerson,
        },
        body: `<html>
          <head>
            <style>
              p { margin: 0; }
            </style>
          </head>
          <body>
            ${emailTemplate.body}
          </body>
        </html>`,
      })
    },
  },
})

export default module
