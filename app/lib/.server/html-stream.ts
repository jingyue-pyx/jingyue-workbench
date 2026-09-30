/** Frame React's stream without cancelling a locked stream or writing after close. */
export function frameHtmlStream(readable: ReadableStream<Uint8Array>, prefix: string, suffix: string) {
  const reader = readable.getReader();
  const encoder = new TextEncoder();
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(prefix));
    },
    async pull(controller) {
      if (closed) {
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (closed) {
          return;
        }

        if (done) {
          closed = true;
          controller.enqueue(encoder.encode(suffix));
          controller.close();
          reader.releaseLock();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        if (closed) {
          return;
        }

        closed = true;
        controller.error(error);
        await reader.cancel(error).catch(() => {});
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      closed = true;

      /*
       * Cancel through the owning reader. readable.cancel() would reject with
       * ERR_INVALID_STATE here because getReader() has locked the stream.
       */
      await reader.cancel(reason).catch(() => {});
      reader.releaseLock();
    },
  });
}
