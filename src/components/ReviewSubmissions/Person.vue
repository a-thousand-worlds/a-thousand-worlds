<script>
import debounce from 'lodash/debounce'
import BalloonEditor from '@ckeditor/ckeditor5-build-balloon'
import creatorTitles from '@/store/constants/creatorTitles'
import almostEqual from '@/util/almostEqual'
import PhotoUpload from '@/components/PhotoUpload'
import SimpleInput from '@/components/fields/SimpleInput'
import Tag from '@/components/Tag'
import Dropdown from '@/components/Dropdown'

export default {
  components: {
    PhotoUpload,
    SimpleInput,
    Tag,
    Dropdown,
  },
  props: ['submission', 'checked'],
  data() {
    return {
      busy: false,
      creatorTitles,
      editor: BalloonEditor,
      image: null,
      sub: this.submission || {},
    }
  },
  computed: {
    ckConfig() {
      return {
        placeholder: 'No bio',
      }
    },
    identities() {
      return Object.keys(this.sub?.identities || {})
    },
    peopleTags() {
      return this.$store.state.tags.people.data
    },
    /** Gets the person with an almost equal name. */
    person() {
      if (!this.sub) return null
      return this.$store.getters['people/findBy'](person => almostEqual(person.name, this.sub.name))
    },
    /** If there is a matching person, get their books. */
    books() {
      if (!this.person) return null
      return this.$store.getters['books/list']().filter(book =>
        Object.keys(book.creators || {}).includes(this.person.id),
      )
    },
    /** Gets the user that createtd the submission. */
    user() {
      return this.$store.state.users.data?.[this.sub?.createdBy]
    },
  },
  watch: {
    submission(next) {
      this.sub = next
    },
  },
  methods: {
    async reject() {
      this.$store.commit('ui/setBusy', true)
      await this.$store.dispatch('submissions/people/reject', this.sub)
      this.$store.commit('ui/setBusy', false)
      this.$store.dispatch('ui/popup', 'Submission rejected')
    },

    save: debounce(async function () {
      await this.$store.dispatch('submissions/people/save', {
        path: this.sub.id,
        value: { ...this.sub },
      })
    }, 500),
  },
}
</script>

<template>
  <div class="container">
    <div class="columns">
      <!-- image -->
      <div class="column is-2 is-offset-1">
        <!-- eslint-disable vue/no-mutating-props -->
        <PhotoUpload
          v-model="submission.photo"
          photoHeight="88px"
          noremove
          @update:model-value="save"
        />
        <!-- eslint-enable vue/no-mutating-props -->
      </div>

      <!-- name -->
      <div class="column is-3">
        <SimpleInput
          v-model="sub.name"
          @update:model-value="save"
          :disabled="busy"
          style="font-weight: bold"
          placeholder="Name"
        />

        <Dropdown
          v-model="sub.title"
          :options="creatorTitles"
          @update:model-value="save"
          style="display: block"
        />

        <Tag
          v-if="!person"
          :tag="{ tag: 'NEW' }"
          nolink
          class="mt-1"
          v-tippy="{
            content:
              'This person is new! When they are approved, they will be added to the people directory but they won\'t have any books.',
          }"
        />
        <div v-else>{{ books.length }} book{{ books.length === 1 ? '' : 's' }}</div>
      </div>

      <div class="column is-5">
        <!-- bio -->
        <div>
          <ckeditor
            @update:model-value="save"
            v-model="sub.bio"
            :disabled="busy"
            class="oneline"
            :editor="editor"
            :config="ckConfig"
            style="padding: 0"
          />
        </div>
        <!-- identities -->
        <div>
          <Tag
            v-for="id of identities"
            :key="id"
            :tag="peopleTags[id]"
            type="people"
            linkToManager
            class="mr-1 mb-1"
            v-tippy="{ content: 'Edit people tags' }"
          />
        </div>
      </div>

      <!-- reject -->
      <div v-if="sub?.status !== 'rejected'" class="column is-1 has-text-right">
        <button
          :class="{ disabled: busy }"
          :disabled="busy"
          v-tippy="{ content: 'Reject submission' }"
          class="is-flat is-uppercase is-underlined"
          @click="reject"
        >
          <i class="fas fa-times" style="font-size: 20px" />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.container {
  padding-top: 2rem;
  margin-top: 2rem;
}

input[type='checkbox'] {
  width: 25px;
  height: 25px;
}

.image-wrapper {
  width: 100%;
  background-size: image;
  position: relative;

  .upload-icon {
    position: absolute;
    top: calc(50% - 36px);
    left: calc(50% - 30px);
    font-size: 3rem;
    display: none;

    &.loading {
      display: block;
    }
  }

  &:hover {
    .upload-icon {
      display: block;
      cursor: pointer;
    }
  }
}

#image-upload {
  display: none;
}
</style>
