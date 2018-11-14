(() => {

	const getDomType = () => {
		// match GET parameter named 'dom'
		let param = window.location.search.match(/(\?|&)dom\=([^&]*)/), // eslint-disable-line no-useless-escape
			dom;
		if (Array.isArray(param) && param.length > 0) {
			dom = decodeURIComponent(param[2]);
		}
		const domType = dom && dom === 'shadow' ? ' | Using shadow DOM' : ' | Using shady DOM';
		return domType;
	};
	Object.assign(window, {
		getDomType
	});
})();
