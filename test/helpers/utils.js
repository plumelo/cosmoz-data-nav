export const flushRenderQueue = nav => {
	while (nav._indexRenderQueue.length) {
		nav._renderQueue();
	}
};

export const selectedSlide = nav => nav.querySelector('div.selected .slide');
export const isVisible = el => Boolean(el.offsetHeight || el.offsetWidth);
export const wait = time => new Promise(resolve => setTimeout(resolve, time));
