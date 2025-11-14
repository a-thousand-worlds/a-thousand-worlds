<script>
import Popup from '@/components/ui/Popup'

export default {
  components: {
    Popup,
  },
}
</script>

<template>
  <div class="popups-area is-flex is-justify-content-center">
    <div style="max-width: 90%; max-height: 200px; overflow: auto">
      <div v-for="popup of $store.state.ui.popups" :key="popup.id">
        <Popup class="mb-2" :popup="popup" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/vars.scss' as *;
@use 'bulma/sass/utilities/mixins' as *;

.popups-area {
  position: fixed;
  z-index: $zPopup;
  font-size: 18px;
  left: 0;
  top: 10px;
  width: 100%;

  @include from($tablet) {
    left: $leftbar-width;
    width: calc(100% - #{$leftbar-width} - #{$rightbar-width});
  }
}
</style>
