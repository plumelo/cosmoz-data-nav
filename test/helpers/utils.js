(() => {
	'use strict';

	const testUtils = {
		flushRenderQueue: nav => {
			while (nav._indexRenderQueue.length) {
				nav._renderQueue();
			}
		},
		selectedSlide: nav => nav.querySelector('div.selected .slide'),
		isVisible: el => Boolean(el.offsetHeight || el.offsetWidth),
		wait: time => new Promise(resolve => setTimeout(resolve, time))
	};

	window.testUtils = testUtils;
})();
