<script>
export default {
  props: {
    format: {
      type: String,
      default: 'link',
      validator: value => ['link', 'button'].includes(value),
    },
    label: {
      type: String,
    },
    labelStyle: {},
    // Unbinded initial selected id
    defaultValue: {
      type: String,
    },
    // Bound initial selected id
    modelValue: {
      type: String,
    },
    options: {
      type: Array,
      required: true,
      validator: arr => arr && arr.every(option => option.id != null && option.text != null),
    },
    placeholder: {
      type: String,
    },
  },
  emits: ['update:modelValue'],
  data() {
    return {
      active: false,
    }
  },
  computed: {
    labelFormatted() {
      const id = this.modelValue ?? this.defaultValue
      return this.label || this.options.find(option => option.id === id)?.text
    },
  },
  methods: {
    close() {
      this.active = false
    },
    select(id) {
      this.$emit('update:modelValue', id)
    },
  },
}
</script>

<template>
  <div>
    <!-- button -->
    <div v-if="format === 'button'" class="dropdown-trigger" style="margin-right: 20px">
      <button
        class="button"
        aria-haspopup="true"
        aria-controls="dropdown-menu"
        @click.prevent.stop="active = !active"
        v-click-outside="close"
        style="margin-bottom: -20px"
      >
        <span style="text-transform: uppercase">{{
          labelFormatted || placeholder || 'Choose'
        }}</span>
        <span class="icon is-small">
          <i class="fas fa-angle-down" aria-hidden="true" />
        </span>
      </button>
    </div>

    <!-- dropdown -->
    <div class="dropdown mt-4 no-user-select" :class="{ 'is-active': active }">
      <div id="dropdown-menu" class="dropdown-menu" role="menu">
        <div class="dropdown-content" style="max-height: 19.5em; overflow: scroll">
          <!-- pre-options -->
          <slot name="beforeOptions" />

          <!-- options -->
          <a
            v-for="option in options"
            :key="option.id"
            class="dropdown-item"
            @click.prevent="select(option.id)"
            :class="{ selected: (modelValue ?? defaultValue) === option?.id }"
          >
            {{ option.text }}
          </a>
        </div>
      </div>
    </div>

    <!-- link -->
    <a
      v-if="format === 'link'"
      @click.prevent.stop="active = !active"
      v-click-outside="close"
      :class="{ 'is-primary': active }"
      class="primary-hover no-user-select"
      :style="labelStyle"
      >{{ labelFormatted || placeholder }}</a
    >
  </div>
</template>

<style lang="scss" scoped>
@use '@/assets/style/mixins.scss' as *;

.selected {
  @include primary(color, !important);
}
</style>
