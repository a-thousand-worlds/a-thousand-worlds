<script>
import parseNames from '@/util/parseNames'

export default {
  props: ['modelValue', 'disabled', 'preText', 'searchDb', 'role', 'placeholder'],
  emits: ['update:modelValue', 'person-selected', 'person-removed'],
  data() {
    return {
      names: this.modelValue || '',
      parseNames,
      people: this.modelValue && this.modelValue.length ? parseNames(this.modelValue) : [],
      searches: [],
      mode: 'view',
    }
  },
  watch: {
    modelValue(next, prev) {
      this.names = next
    },
  },
  methods: {
    doSearch(e) {
      this.$emit('update:modelValue', this.names)
      if (!this.searchDb) {
        return
      }
      const search = this.names
      this.searches = this.$store.getters['people/list']().filter(
        person =>
          search.length && person.name.toLowerCase().includes(search) && person.role === this.role,
      )
    },
    fillPerson(p) {
      this.searches = []
      /*
      this.person.id = p.id
      this.person.role = p.role
      this.$emit('update:modelValue', this.names)
      this.$emit('person-selected', p)
      /**/
      this.mode = 'view'
    },
    onDivClick() {
      if (this.disabled) {
        return
      }
      this.mode = 'edit'
      // on the moment of function execution $refs.input
      // is still not exists beacuse of v-if
      // so timeout 0 used to wait it to be created
      setTimeout(() => {
        this.$refs.input.focus()
      }, 0)
    },
    onClickOutside(e) {
      this.searches = []
      if (e.target === this.$refs.input) {
        return
      }
      this.mode = 'view'
    },
    onEnter() {
      this.searches = []
      this.mode = 'view'
    },
    onInputBlur() {
      if (this.searches.length) {
        return
      }
      this.people = parseNames(this.names)
      this.$emit('update:modelValue', this.people.join(', '))
      this.mode = 'view'
    },
    onEsc() {
      if (this.searches.length) {
        this.searches = []
        return
      }
      this.mode = 'view'
    },
  },
}
</script>

<template>
  <div class="control">
    <div class="field is-grouped">
      <div class="control is-flex is-flex-wrap-wrap w-100">
        <div class="mr-1 nowrap" style="font-weight: bold">{{ preText }}</div>
        <div
          v-if="mode === 'view' && !names?.length && placeholder?.length"
          :class="{ disabled: disabled }"
          class="w-50 pointer placeholder"
          @click="onDivClick"
        >
          {{ placeholder }}
        </div>
        <div
          v-if="mode === 'view' && names?.length"
          :class="{ disabled: disabled }"
          class="pointer"
          :title="placeholder"
          @click="onDivClick"
        >
          {{ names }}
        </div>
        <input
          v-if="mode === 'edit'"
          ref="input"
          v-model="names"
          type="text"
          class="input w-50"
          @blur="onInputBlur"
          @keyup.enter="onEnter"
          @keyup.escape="onEsc"
          @input="doSearch"
        />
        <div v-if="searches.length" v-click-outside="onClickOutside" class="search-wrap">
          <div class="search-results">
            <div
              v-for="res of searches"
              :key="res.id"
              class="media p-2"
              @click.prevent="fillPerson(res)"
            >
              <b>{{ res.name }}</b
              ><br />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@/assets/style/vars.scss' as *;

.input {
  margin-top: -0.25rem;
  margin-left: -0.25rem;
  padding: 0.2rem;
  height: 2rem;
}

.w-50 {
  min-width: 50%;
  min-height: 24px;
}

.placeholder {
  font-style: italic;
  color: #aaa;
}

.pointer {
  cursor: text;
}

.disabled {
  color: #ddd;
}

.search-wrap {
  position: relative;
  .search-results {
    position: absolute;
    width: 100%;
    max-height: 400px;
    overflow-y: scroll;
    left: 0;
    top: 0;
    z-index: $zField;
    background: #fff;
    border: 1px solid;

    img {
      max-height: 60px;
    }

    .media {
      margin: 0 !important;

      &:hover {
        background: #eee;
      }
    }
  }
}
</style>
