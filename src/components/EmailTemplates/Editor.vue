<script>
import Content from '@/components/Content'
import validator from '@/mixins/validator'

export default {
  components: {
    Content,
  },
  mixins: [
    validator(function () {
      return [
        ...this.validateEmailTemplate(this.$refs.subject?.html, 'subject'),
        ...this.validateEmailTemplate(this.$refs.body?.html, 'body'),
      ]
    }),
  ],
  data() {
    // organize content into groups
    const groups = [
      {
        title: 'Invitation',
        items: this.$allowedInviteeRoles(),
        to: [
          {
            description: item =>
              `This email is sent to someone who is invited to sign up as ${
                item === 'advisor' || item === 'owner' ? 'an' : 'a'
              } ${item}.`,
            path: 'email/invite',
          },
        ],
      },
      {
        title: 'Pending Submission',
        items: ['book', 'bundle', 'people'],
        to: [
          {
            description: item =>
              `This email is sent to the site owner when a new ${item} submission is pending.`,
            path: 'email/submissions/pending',
          },
        ],
      },
      {
        title: 'Approved Submission',
        items: ['book', 'bundle', 'people'],
        to: [
          {
            description: item =>
              `This email is sent to ${
                item === 'people' ? 'creators' : 'contributors'
              } when their ${item} submission is approved.`,
            path: 'email/submissions/approved',
          },
        ],
      },
      {
        title: 'Rejected Submission',
        items: ['book', 'bundle', 'people'],
        to: [
          {
            description: item =>
              `This email is sent to ${
                item === 'people' ? 'creators' : 'contributors'
              } when their ${item} submission is rejected.`,
            path: 'email/submissions/rejected',
          },
        ],
      },
    ]

    return {
      // start with the first item in the first group selected
      active: {
        group: groups[0],
        item: groups[0].items[0],
      },
      groups,
    }
  },
  computed: {
    subjectErrors() {
      return this.errors.filter(error => error.name === 'subject')
    },
    bodyErrors() {
      return this.errors.filter(error => error.name === 'body')
    },
  },
  watch: {
    active() {
      this.validate(this.$refs.subject)
      this.validate(this.$refs.body)
    },
  },
  mounted() {
    this.validate()
  },
  methods: {
    validateEmailTemplate(html, name) {
      if (html == null) return []
      const templateVariables = html.match(/\w+_\w+/g)

      const isValidTemplateVariable = variable =>
        [
          'FIRST_NAME',
          'LAST_NAME',
          'FULL_NAME',
          'SIGNUP_LINK',
          'NEW_BOOKS',
          'NEW_BUNDLES',
          'NEW_PERSON',
        ].includes(variable)

      return (templateVariables || [])
        .map(variable =>
          !isValidTemplateVariable(variable)
            ? {
                name,
                message: `${variable} is not a valid template variable.`,
              }
            : null,
        )
        .filter(x => x)
    },
  },
}
</script>

<template>
  <div class="editor-component columns">
    <div class="column is-one-quarter">
      <aside class="menu">
        <div v-for="group of groups" :key="group.title" class="mb-20">
          <p class="menu-label">{{ group.title }}{{ group.title.endsWith('ed') ? '' : 's' }}</p>
          <ul class="menu-list">
            <li v-for="item of group.items" :key="item" class="is-capitalized">
              <a
                :class="{ 'is-active': item === active.item && group === active.group }"
                @click.prevent="active = { group, item }"
                >{{ item }}</a
              >
            </li>
          </ul>
        </div>
      </aside>
    </div>

    <div class="column is-three-quarters">
      <!-- <h2 class="is-capitalized">{{ active.group }}</h2> -->
      <div class="ml-20">
        <h3 class="is-capitalized mb-10">{{ active.group.title }}: {{ active.item }}</h3>
        <div v-for="recipient in active.group.to" :key="recipient.path">
          <p v-if="recipient.description" class="mb-20">
            {{
              typeof recipient.description === 'string'
                ? recipient.description
                : recipient.description(active.item)
            }}
          </p>
          <div class="mb-20">
            <p
              class="mb-10"
              :class="{ 'has-text-danger': hasError('subject') }"
              style="font-weight: bold"
            >
              Subject:
            </p>
            <Content
              ref="subject"
              :name="`${recipient.path}/${active.item}/subject`"
              :class="{ 'is-danger': hasError('subject'), 'content-subject': true }"
              format="oneline"
              @change="validate"
            />
            <div v-if="subjectErrors.length" class="field">
              <p v-for="(error, i) of subjectErrors" :key="i" class="error my-10">
                {{ error.message || 'Unknown error' }}
              </p>
            </div>
          </div>
          <div class="mb-20">
            <p
              class="mb-10"
              :class="{ 'has-text-danger': hasError('body') }"
              style="font-weight: bold"
            >
              Message:
            </p>
            <div :class="{ 'content-container-error': hasError('body') }">
              <Content
                ref="body"
                :name="`${recipient.path}/${active.item}/body`"
                class="content-email-body"
                @change="validate"
              />
            </div>
            <div v-if="bodyErrors.length" class="field">
              <p v-for="(error, i) of bodyErrors" :key="i" class="error my-10">
                {{ error.message || 'Unknown error' }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/vars.scss' as *;
@use '@/assets/style/mixins.scss' as *;

.content-email-body {
  outline: solid 1px #ddd;
  min-height: 10rem;
}

.menu-list a.is-active {
  @include primary(background-color);
}

// cannot add is-danger directly to Content element since dynamic classes interfere with CKEditor classes
.content-container-error {
  .content-email-body {
    border-color: $danger !important;
    &:focus,
    &.is-focused,
    &:active,
    &.is-active {
      box-shadow: 0 0 0 0.1875em bulmaRgba($danger, 0.25);
    }
  }
}
</style>

<style lang="scss">
.editor-component {
  input.content-subject:not(:focus) {
    cursor: text;
  }

  .content-email-body.ck.ck-editor__editable_inline {
    margin: 0;
    outline: solid 1px #ddd;
    padding: 10px;
    cursor: text;
  }
}
</style>
