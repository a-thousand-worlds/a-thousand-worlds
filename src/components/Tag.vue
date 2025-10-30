<script>
import slugify from '@sindresorhus/slugify'

export default {
  props: {
    buttonClass: {},
    editable: Boolean,
    nolink: Boolean,
    tag: {
      required: true,
    },
    tagStyle: String,
    type: {
      type: String,
      validator: value => ['books', 'bundles', 'people'].indexOf(value) !== -1,
    },
  },
  emits: ['click', 'remove'],
  computed: {
    // map the prop type to the router type
    routerType() {
      return this.type === 'books'
        ? 'Home'
        : this.type === 'people'
          ? 'People'
          : this.type === 'bundles'
            ? 'Bundles'
            : null
    },
    singleType() {
      return this.type === 'books'
        ? 'book'
        : this.type === 'people'
          ? 'person'
          : this.type === 'bundles'
            ? 'bundle'
            : null
    },
  },
  created() {
    if (!this.nolink && !this.type) {
      console.error('components/Tag: Type attribute is required unless nolink is specified.')
    }
  },
  methods: {
    goToFilter() {
      this.$store.commit(`${this.type}/setFilters`, [this.tag])
      this.$router.push({ name: this.routerType, query: { filters: slugify(this.tag.tag) } })
    },
    goToManager() {
      this.$router.push({ name: 'TagsManager', query: { active: this.type } })
    },
    onClick() {
      this.$emit('click', this.tag)
    },
    removeTag() {
      this.$emit('remove', this.tag)
    },
  },
}
</script>

<template>
  <div v-if="tag" class="mr-1" style="display: inline-block">
    <span
      v-if="nolink"
      @click="onClick"
      :class="buttonClass"
      class="button is-primary is-rounded is-mini nolink"
      style="cursor: default; font-size: 10px"
      :style="tagStyle"
    >
      <span
        ><slot>{{ tag.tag }}</slot></span
      >
      <span
        v-if="editable"
        class="close"
        v-tippy="{ content: `Remove tag from ${singleType}` }"
        @click="removeTag"
        >✕</span
      >
    </span>

    <button
      v-else-if="editable"
      @click="onClick"
      :class="buttonClass"
      class="button is-primary is-rounded is-mini"
      style="cursor: default; font-size: 10px"
      :style="tagStyle"
    >
      <!-- reset color to inherit, otherwise it will become the primary color on hover and disappear on the primary colored background -->
      <a @click.prevent.stop="goToManager" style="color: inherit">{{ tag.tag }}</a>
      <span
        v-if="editable"
        class="close"
        v-tippy="{ content: `Remove tag from ${singleType}` }"
        @click="removeTag"
        >✕</span
      >
    </button>

    <button
      v-else
      :class="buttonClass"
      @click="onClick"
      class="button is-primary is-rounded is-mini mb-1"
      style="
        display: inline-block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
      "
      :style="tagStyle"
    >
      <span @click="goToFilter">{{ tag.tag }}</span>
      <span
        v-if="editable"
        class="close"
        v-tippy="{ content: 'Remove tag from book' }"
        @click="removeTag"
        >✕</span
      >
    </button>
  </div>
</template>

<style lang="scss" scoped>
@use '@/assets/style/mixins.scss' as *;

.close {
  background-color: rgba(0, 0, 0, 0.25);
  border-radius: 999px;
  cursor: pointer;
  display: inline-block;
  font-size: 10px;
  height: 13px;
  line-height: 1.5;
  margin: 0 -4px 0 5px;
  vertical-align: middle;
  width: 13px;

  .is-outlined & {
    background-color: transparent;
  }
}

.button.is-primary.nolink:hover {
  @include primary(color, !important);
  background-color: inherit !important;
}
</style>
