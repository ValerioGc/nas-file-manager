<script setup lang="ts">

import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { locale, useI18n } from '@/i18n';
import { usePreferences } from '@/composables/usePreferences';
import { useShares } from '@/composables/useShares';
import { downloadUrl, getVideoFramePreview, previewUrl } from '@/services/filesystem';
import type { FileEntry } from '@/types/files';

import archiveIcon from '@/assets/icons/thumbnail-archive.svg?url';
import documentIcon from '@/assets/icons/thumbnail-document.svg?url';
import fileIcon from '@/assets/icons/thumbnail-file.svg?url';
import folderIcon from '@/assets/icons/thumbnail-folder.svg?url';
import imageIcon from '@/assets/icons/thumbnail-image.svg?url';
import videoIcon from '@/assets/icons/thumbnail-video.svg?url';
import shareIcon from '@/assets/icons/share.svg?url';
import silentTrack from '@/assets/media/silent-preview.vtt?url';

const props = defineProps<{ file: FileEntry }>();
const { preferences } = usePreferences();
const { isShared } = useShares();
const { t } = useI18n();
const shared = computed(() => props.file.kind === 'folder' && isShared(props.file.path));
const previewSrc = ref<string | null>(null);
const animatedSrc = ref<string | null>(null);
const isPreviewLoading = ref(false);

const visible = ref(typeof IntersectionObserver === 'undefined');
const element = useTemplateRef<HTMLElement>('thumbnail');
let observer: IntersectionObserver | undefined;

const thumbnailIcons = {
  archive: archiveIcon,
  document: documentIcon,
  file: fileIcon,
  folder: folderIcon,
  image: imageIcon,
  video: videoIcon,
};

onMounted(() => {
  if (visible.value || !element.value) {
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible.value = true;
        observer?.disconnect();
      }
    },
    { rootMargin: '200px' },
  );
  observer.observe(element.value);
});

let requestId = 0;
watch(
  () =>
    [
      props.file.path,
      props.file.modified,
      props.file.size,
      preferences.value.generatePreviews,
      visible.value,
    ] as const,
  async () => {
    const request = ++requestId;
    previewSrc.value = null;
    stopAnimatedPreview();
    isPreviewLoading.value = false;
    if (props.file.kind === 'folder' || !preferences.value.generatePreviews || !visible.value) {
      return;
    }

    isPreviewLoading.value = true;
    if (props.file.kind !== 'video') {
      previewSrc.value = previewUrl(props.file, 'small');
      return;
    }
    try {
      const preview = await getVideoFramePreview(props.file);
      if (request === requestId) {
        previewSrc.value = preview.src;
      }
    } catch {
      if (request === requestId) {
        isPreviewLoading.value = false;
      }
    }
  },
  { immediate: true },
);

function previewLoaded() {
  isPreviewLoading.value = false;
}

function previewFailed() {
  previewSrc.value = null;
  isPreviewLoading.value = false;
}

/** Plays the video streamed from the NAS, so only what is shown gets downloaded. */
function startAnimatedPreview() {
  if (
    props.file.kind !== 'video' ||
    !preferences.value.generatePreviews ||
    !preferences.value.animatedPreviews ||
    animatedSrc.value
  ) {
    return;
  }
  animatedSrc.value = downloadUrl(props.file.path);
}

/** Removing the video stops its download. */
function stopAnimatedPreview() {
  animatedSrc.value = null;
}

function handleAnimatedError() {
  stopAnimatedPreview();
}

onBeforeUnmount(() => {
  observer?.disconnect();
  stopAnimatedPreview();
});

</script>

<template>
  <span
    ref="thumbnail"
    class="file_thumbnail"
    :class="file.kind"
    @mouseenter="startAnimatedPreview"
    @mouseleave="stopAnimatedPreview"
    @focusin="startAnimatedPreview"
    @focusout="stopAnimatedPreview"
  >
    <span v-if="isPreviewLoading" class="file_thumbnail_loading" aria-hidden="true"></span>
    <video
      v-if="animatedSrc"
      :src="animatedSrc"
      autoplay
      loop
      muted
      playsinline
      @error="handleAnimatedError"
    >
      <track kind="captions" :src="silentTrack" :srclang="locale" />
      <track kind="descriptions" :src="silentTrack" :srclang="locale" />
    </video>
    <img
      v-else-if="previewSrc"
      v-show="!isPreviewLoading"
      :src="previewSrc"
      alt=""
      decoding="async"
      @load="previewLoaded"
      @error="previewFailed"
    />
    <img v-else-if="!isPreviewLoading" :src="thumbnailIcons[file.kind]" alt="" loading="lazy" />
    <svg
      v-if="shared"
      class="file_thumbnail_shared"
      viewBox="0 0 100 100"
      :aria-label="t.sharedBadge"
      data-testid="shared_badge"
    >
      <title>{{ t.sharedBadge }}</title>
      <rect
        x="18%"
        y="18%"
        width="64%"
        height="64%"
        :style="{ '--share-icon': `url(${JSON.stringify(shareIcon)})` }"
      />
    </svg>
  </span>
</template>

<style scoped lang="scss">

.file_thumbnail {
  @extend %grid_center;
  position: relative;
  overflow: hidden;
  place-items: center;
  background: var(--accent-soft);

  &.folder {
    background: #fff5dc;
  }

  img,
  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  // Corner badge with the share symbol masked in the surface colour.
  &_shared {
    position: absolute;
    right: 6%;
    bottom: 6%;
    width: 42%;
    max-width: 22px;
    min-width: 12px;
    aspect-ratio: 1;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--accent);

    rect {
      fill: var(--surface);
      mask: var(--share-icon) center / contain no-repeat;
    }
  }

  &_loading {
    width: 72%;
    height: 72%;
    border-radius: 10px;
    background: linear-gradient(
      110deg,
      var(--surface-soft) 8%,
      var(--border) 18%,
      var(--surface-soft) 33%
    );
    background-size: 200% 100%;
    animation: thumbnail_loading 1.2s linear infinite;
  }
}

@keyframes thumbnail_loading {
  to {
    background-position-x: -200%;
  }
}

</style>
