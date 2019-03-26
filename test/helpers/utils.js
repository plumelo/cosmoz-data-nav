(() => {
	const flushRenderQueue = nav => {
		while (nav._indexRenderQueue.length) {
			nav._renderQueue();
		}
	};

	Object.assign(window, {
		flushRenderQueue
	});
})();
