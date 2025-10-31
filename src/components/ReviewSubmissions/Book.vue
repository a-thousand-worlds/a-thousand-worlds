<script>
import debounce from 'lodash/debounce'
import BalloonEditor from '@ckeditor/ckeditor5-build-balloon'
import almostEqual from '@/util/almostEqual'
import parseNames from '@/util/parseNames'
import MultiPersonField from '@/components/fields/MultiPerson'
import SimpleInput from '@/components/fields/SimpleInput'
import Tag from '@/components/Tag'

export default {
  components: {
    MultiPersonField,
    SimpleInput,
    Tag,
  },
  props: ['submission', 'modelValue', 'checked'],
  data() {
    return {
      busy: false,
      ckConfig: {
        placeholder: 'No summary',
      },
      sub: this.submission || {},
      editor: BalloonEditor,
      cover: null,
      people: [],
    }
  },
  computed: {
    coverRatio() {
      return (this.sub.cover?.height / this.sub.cover?.width) * 100 || 100
    },
    coverUrl() {
      return (
        this.sub.cover?.url ||
        (this.sub.cover?.base64
          ? this.sub.cover.base64.startsWith('data:image')
            ? this.sub.cover?.base64
            : `data:image/png;base64,${this.sub.cover.base64}`
          : '') ||
        this.sub.thumbnail
      )
    },
    /** Returns true if all authors exist in the people directory already. */
    authorsExist() {
      if (!this.sub) return null
      const authors = parseNames(this.sub.authors)
      return authors.every(name =>
        this.$store.getters['people/findBy'](person => almostEqual(name, person.name)),
      )
    },
    /** Returns true if all authors exist in the people directory already. */
    illustratorsExist() {
      if (!this.sub) return null
      const illustrators = parseNames(this.sub.illustrators)
      return illustrators.every(name =>
        this.$store.getters['people/findBy'](person => almostEqual(name, person.name)),
      )
    },
    tags() {
      return this.$store.getters['tags/books/listSorted']().filter(
        tag => this.sub.tags && this.sub.tags[tag.id],
      )
    },
  },
  watch: {
    submission(next) {
      this.sub = next
    },
  },
  methods: {
    async reject() {
      await this.$store.commit('ui/setBusy', true)
      await this.$store.dispatch('submissions/books/reject', this.sub)
      await this.$store.commit('ui/setBusy', false)
      this.$store.dispatch('ui/popup', 'Submission rejected')
    },
    save: debounce(async function () {
      await this.$store.dispatch('submissions/books/save', {
        path: this.sub.id,
        value: { ...this.sub },
      })
    }, 500),
    fileChange(e) {
      const file = e.target.files[0]
      const reader = new FileReader()

      // save `this` component instance since onload handler needs to reference its inner `this`
      const _this = this
      reader.onload = async () => {
        // load width and height
        const image = new Image()
        image.onload = function () {
          _this.sub.cover = {
            base64: reader.result,
            height: this.width,
            width: this.height,
          }
          _this.save()
        }
        image.src = reader.result
      }
      reader.onerror = err => {
        console.error('FileReader error', err)
      }
      reader.readAsDataURL(file)
    },
  },
}
</script>

<template>
  <div class="container">
    <div class="columns">
      <!--
    <div class="column is-1">
      <input :disabled="busy" type="checkbox" v-model="selected"/>
    </div>
    -->

      <!-- cover -->
      <div class="column is-2 is-offset-1">
        <div
          class="bg-secondary cover-wrapper"
          :style="{ 'padding-top': coverRatio + '%', 'background-image': `url(${coverUrl})` }"
        >
          <div v-if="busy" class="upload-icon loading">
            <i class="fas fa-spinner fa-pulse fa-fw" />
          </div>
          <label v-if="!busy" class="upload-icon" for="cover-upload">
            <i class="fas fa-file-upload fa-fw" />
          </label>
          <input
            id="cover-upload"
            type="file"
            class="cover-file-uploader"
            @change.prevent="fileChange($event)"
          />
        </div>
      </div>

      <!-- title, authors, illustrators -->
      <div class="column is-3">
        <!-- title -->
        <div style="font-weight: bold">
          <SimpleInput
            v-model="sub.title"
            @update:modelValue="save"
            :disabled="busy"
            placeholder="Title"
            controlStyle="font-size: 20px;"
          />
        </div>

        <!-- author(s) -->
        <div>
          <MultiPersonField
            v-model="sub.authors"
            @update:modelValue="save"
            :disabled="busy"
            :search-db="false"
            placeholder="author(s)"
            pre-text="words by"
            role="author"
            :class="!authorsExist && 'mr-1'"
            :style="!authorsExist && { display: 'inline-block' }"
          />
          <Tag
            v-if="!authorsExist"
            :tag="{ tag: 'NEW' }"
            nolink
            v-tippy="{
              content:
                'This author is new! When the book is approved, they will be added to the people directory.',
            }"
          />
        </div>

        <!-- illustrator(s) -->
        <div>
          <MultiPersonField
            v-model="sub.illustrators"
            @update:modelValue="save"
            :disabled="busy"
            :placeholder="'illustrator(s)'"
            :search-db="false"
            role="illustrator"
            pre-text="illustrated by"
            :class="!authorsExist && 'mr-1'"
            :style="!illustratorsExist && { display: 'inline-block' }"
          />
          <Tag
            v-if="!illustratorsExist"
            :tag="{ tag: 'NEW' }"
            nolink
            v-tippy="{
              content:
                'This illustrator is new! When the book is approved, they will be added to the people directory.',
            }"
          />
        </div>

        <!-- ISBN -->
        <div class="is-flex">
          <b class="mr-1">isbn</b>
          <SimpleInput
            :disabled="busy"
            @update:modelValue="save"
            v-model="sub.isbn"
            placeholder="Enter ISBN"
          />
        </div>

        <!-- year -->
        <div class="flex">
          <b class="mr-1">year</b>
          <SimpleInput
            v-model="sub.year"
            @update:modelValue="save"
            :disabled="busy"
            placeholder="Enter Year"
            style="display: inline-block"
          />
        </div>

        <!--
        <div>
          <SimpleInput
            :disabled="busy"
            @update:modelValue="save"
            v-model="sub.publisher"
            placeholder="Publisher"
          />
        </div>
        -->
      </div>

      <div class="column is-5" style="margin-top: -20px">
        <!-- summary -->
        <div class="mb-10" style="max-height: 25rem; overflow: scroll">
          <ckeditor
            @update:modelValue="save"
            v-model="sub.summary"
            :disabled="busy"
            class="oneline"
            :editor="editor"
            :config="ckConfig"
            style="padding: 0"
          />
        </div>
        <!-- tags -->
        <div class="tags">
          <Tag
            v-for="tag of tags"
            :key="tag.id"
            :tag="tag"
            type="books"
            linkToManager
            class="mr-1 mb-1"
            v-tippy="{ content: 'Edit book tags' }"
          />
        </div>
      </div>

      <!-- reject -->
      <div v-if="sub?.status !== 'rejected'" class="column is-1 has-text-right">
        <button
          :class="{ disabled: busy }"
          :disabled="busy"
          class="is-flat is-uppercase is-underlined"
          @click="reject"
        >
          <i
            class="fas fa-times"
            style="font-size: 20px"
            v-tippy="{ content: `Reject submission` }"
          />
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

h3.title {
  font-size: 110%;
}

input[type='checkbox'] {
  width: 25px;
  height: 25px;
}

.ck-read-only {
  color: #aaa;
}

.cover-wrapper {
  width: 100%;
  background-size: cover;
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

#cover-upload {
  display: none;
}

.columns2 {
  column-count: 2;

  .label {
    position: relative;
    top: -7px;
  }

  .input.is-inline {
    margin-top: -7px;
  }
}
</style>
