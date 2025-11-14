<script>
import Content from '@/components/Content'

export default {
  components: {
    Content,
  },
}
</script>

<template>
  <div class="welcome-banner" ref="welcome">
    <!-- account for 10px column padding and 10px whitespace on bottom of stacked logo -->
    <div class="columns px-20 mt-50 mb-40" style="max-width: 1400px; margin: auto">
      <!-- use a small bottom margin to bump up slightly from center to match the spec -->
      <div
        class="column left is-flex is-justify-content-center is-align-items-center"
        style="margin-top: -25px"
      >
        <Content name="welcome/left" placeholder="Colorful Reads x Colorful People" />
      </div>

      <div class="column">
        <img
          :src="require(`@/assets/logo/${$store.state.theme}/stacked.png`)"
          class="logo"
          title="A Thousand Worlds"
        />
      </div>

      <!-- use a small bottom margin to bump up slightly from center to match the spec -->
      <div class="column" style="margin-top: -25px">
        <!-- set max-width to achieve desired line breaks while maintaining responsiveness -->
        <div
          class="subtitle is-flex is-align-items-center"
          style="height: 100%; max-width: 10.5em; margin: auto"
        >
          <Content
            name="welcome/right"
            placeholder="Picture books curated by BIPOC leaders in the industry"
            style="text-align: center"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<!-- do not scope so that we can style CKEditor -->
<style lang="scss">
@use '@/assets/style/vars.scss' as *;
@use 'bulma/sass/utilities/mixins' as *;

.welcome-banner {
  background-color: white;
  width: 100%;
  top: 0;
  text-align: center;
  font-family: 'GT Walsheim', Sen, sans-serif;
  font-size: 20px;

  @include from($widescreen) {
    font-size: 20px;
  }

  .column {
    padding: 10px;
  }

  .ck p {
    text-align: center;
    line-height: 1.5;
  }

  .subtitle {
    line-height: 31px;
  }

  .logo {
    width: 100%;
    max-width: 344px;
  }
}
</style>
