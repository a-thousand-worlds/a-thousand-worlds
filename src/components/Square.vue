<!-- A square component that expands to fit while maintaining a 1:1 aspect ratio. -->

<script>
export default {
  props: {
    color: {
      type: String,
      validator: value => ['primary', 'secondary'].indexOf(value) !== -1,
      default: 'secondary',
    },
  },
}
</script>

<template>
  <div
    class="square is-flex is-justify-content-center is-align-items-center"
    :class="'bg-' + color"
  >
    <slot />
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/mixins.scss' as *;
@use 'bulma/sass/utilities/mixins' as *;

.square {
  color: black;
  position: relative;
  padding: 20px;
  white-space: nowrap;

  &:hover {
    @include primary(color);
  }

  h3 {
    position: relative;
  }

  // shrink text on tablet
  // not mobile since the container becomes big again when stacked
  @include tablet-only {
    h3 {
      font-size: 20px;
    }
  }
}

.square:after {
  content: '';
  display: block;
  padding-bottom: 100%;
}
</style>
