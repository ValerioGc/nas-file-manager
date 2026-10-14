<script setup lang="ts">

import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import archiveIcon from '@/assets/icons/thumbnail-archive.svg?url';
import documentIcon from '@/assets/icons/thumbnail-document.svg?url';
import fileIcon from '@/assets/icons/thumbnail-file.svg?url';
import folderIcon from '@/assets/icons/thumbnail-folder.svg?url';
import imageIcon from '@/assets/icons/thumbnail-image.svg?url';
import videoIcon from '@/assets/icons/thumbnail-video.svg?url';
import shareIcon from '@/assets/icons/share.svg?url';
// The animated preview is a muted loop: it has no speech to caption and nothing to describe.
import silentTrack from '@/assets/media/silent-preview.vtt?url';
import { locale, useI18n } from '@/i18n';
import { usePreferences } from '@/composables/usePreferences';
import { useShares } from '@/composables/useShares';
import { downloadFile, getVideoFramePreview, previewUrl } from '@/services/filesystem';
import type { FileEntry } from '@/types/files';

const props = defineProps<{ file: FileEntry }>();
const { preferences } = usePreferences();
const { isShared } = useShares();
const { t } = useI18n();
// A folder shared on the local network carries a badge over its icon.
const shared = computed(() => props.file.kind === 'folder' && isShared(props.file.path));
const previewSrc = ref<string | null>(null);
const animatedSrc = ref<string | null>(null);
const isPreviewLoading = ref(false);
const isAnimatedLoading = ref(false);
// Only a thumbnail on the screen, or about to be, asks for its preview: a folder of thousands of
// photos does not make the NAS decode them all at once.
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
      // The browser fetches it, and keeps it: the image says when it is there.
      previewSrc.value = previewUrl(props.file, 'small');
      return;
    }
    try {
      const preview = await getVideoFramePreview(props.file);
      if (request === requestId) {
        previewSrc.value = preview.src;
      }
    } catch {
      // The file type icon is the accessible fallback when a preview is unavailable.
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

/** A preview the NAS could not make: the icon of the kind of file, as without previews. */
function previewFailed() {
  previewSrc.value = null;
  isPreviewLoading.value = false;
}

async function startAnimatedPreview() {
  if (
    props.file.kind !== 'video' ||
    !preferences.value.generatePreviews ||
    !preferences.value.animatedPreviews ||
    animatedSrc.value ||
    isAnimatedLoading.value
  ) {
    return;
  }

  isAnimatedLoading.value = true;
  try {
    const resource = await downloadFile(props.file.path);
    animatedSrc.value = URL.createObjectURL(resource.blob);
  } catch {
    animatedSrc.value = null;
  } finally {
    isAnimatedLoading.value = false;
  }
}

function stopAnimatedPreview() {
  if (animatedSrc.value) {
    URL.revokeObjectURL(animatedSrc.value);
  }
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
    <span
      v-if="shared"
      class="file_thumbnail_shared"
      role="img"
      :aria-label="t.sharedBadge"
      :title="t.sharedBadge"
      data-testid="shared_badge"
      :style="{ '--share-icon': `url(${JSON.stringify(shareIcon)})` }"
    ></span>
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

  // A small circle in the corner, the symbol of the share masked in the colour of the surface.
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

    &::after {
      content: '';
      position: absolute;
      inset: 18%;
      background: var(--surface);
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
