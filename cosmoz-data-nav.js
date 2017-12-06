// @license Copyright (C) 2015 Neovici AB - Apache 2 License
/*global Cosmoz, Polymer */

(function () {
	'use strict';
	const IS_V2 = Polymer.flush != null;

	Polymer({
		is: 'cosmoz-data-nav',
		properties: {
			/**
			 * The name of the variable to add to the binding scope for the array
			 * element associated with a template instance.
			 */
			as: {
				type: String,
				value: 'item'
			},

			/**
			* The name of the variable to add to the binding scope with the index
			* for the item.
			*/
			indexAs: {
				type: String,
				value: 'index'
			},

			/**
			 * True if first item is selected.
			 */
			nextDisabled: {
				type: Boolean,
				notify: true,
				readOnly: true,
				value: true
			},

			/**
			 *  True if last item is selected.
			 */
			prevDisabled: {
				type: Boolean,
				notify: true,
				readOnly: true,
				value: true
			},

			/**
			 * An array containing items from which a selection can be made.
			 */
			items: {
				type: Array,
				value: function () {
					return [];
				},
				notify: true,
				observer: '_itemsChanged'
			},

			/**
			 * The length of items array.
			 */
			queueLength: {
				type: Number,
				notify: true,
				readOnly: true
			},

			/**
			 * Number of items after the currently selected one to preload.
			 */
			preload: {
				type: Number,
				value: 2
			},

			/**
			 * The currently selected index.
			 */
			selected: {
				type: Number,
				notify: true,
				observer: '_updateSelected'
			},

			/**
			 * The index of the next element.
			 */
			selectedNext: {
				type: Number,
				notify: true,
				value: 1,
				readOnly: true
			},

			/**
			 * The currently selected item, or `null` if no item is selected.
			 */
			selectedItem: {
				type: Object,
				notify: true,
				readOnly: true
			},

			/**
			 * The attribute that elements which control the `selected` of this element
			 * should have. The value of the attribute can be `-1` or `+1`.
			 */
			selectAttribute: {
				type: String,
				value: 'cosmoz-data-nav-select'
			},

			/**
			 *  True if the element is currently animating.
			 */
			animating: {
				type: Boolean,
				value: false,
				reflectToAttribute: true,
			},

			/**
			 * True if selecting a element with a index smaller than the current one.
			 */
			reverse: {
				type: Boolean,
				value: false,
				reflectToAttribute: true,
			},

			/**
			 * Function used to determine if a item is incomplete and needs to be preloaded.
			 * The default values is a function that requires item to be a `Object`.
			 */
			isIncompleteFn: {
				type: Function,
				value() {
					return  item => {
						return item == null || typeof item !== 'object';
					};
				}
			}
		},

		behaviors: [
			Polymer.Templatizer,
			Polymer.IronResizableBehavior
		],

		listeners: {
			tap: '_onTap',
			transitionend: '_onTransitionEnd'
		},

		/**
		 * Polymer `created` livecycle function.
		 *
		 * @return {void}
		 */
		created() {
			this._cache = {};
			this._elements = [];
			this._elementsBuffer = 3;
		},

		/**
		 * Polymer `attached` livecycle function.
		 *
		 * @return {void}
		 */
		attached() {
			this._observer = Polymer.dom(this).observeNodes(this._onNodesChange);
		},

		/**
		 * Polymer `detached` livecycle function.
		 *
		 * @return {void}
		 */
		detached() {
			if (this._observer) {
				Polymer.dom(this).unobserveNodes(this._observer);
				this._observer = null;
			}
			this._cache = {};
		},

		_onNodesChange() {
			if (this._userTemplate) {
				return;
			}
			const template = this.queryEffectiveChildren('template');

			if (!template) {
				console.warn('cosmoz-data-nav requires a template');
				return;
			}

			this._userTemplate = template;
			this._ensureTemplatized();

			Array(this._elementsBuffer).fill(null).forEach(this._createElement, this);

		},

		_createElement() {
			const elements = this._elements,
				index = elements.length,
				element = document.createElement('div');

			element.classList.add('animatable', 'incomplete');
			elements.push(element);

			Polymer.dom(this).appendChild(element);

			if (this.selected != null && index === this.selected) {
				this.animating = false;
				this._updateSelected();
				return;
			}
			this._forwardItem(element, this.items[index]);
		},

		_ensureTemplatized() {
			if (this.ctor || !this._userTemplate) {
				return;
			}
			const props =  {
				prevDisabled: true,
				nextDisabled: true
			};
			props[this.as] = true;
			props[this.indexAs] = true;

			this._instanceProps = props;
			this._parentModel = true;
			this._templateInstances = [];
			this.templatize(this._userTemplate);
		},

		/**
		 * Selects an item by index.
		 *
		 * @param  {Number} index The index
		 * @return {void}
		 */
		select(index) {
			const length = this.items && this.items.length;
			if (!length || index < 0 || index >= length) {
				return;
			}
			this.reverse = index < this.selected;
			this.selected = index;
		},

		/**
		 * Replace an id in the `items` element list with the full data of the item.
		 *
		 * @param  {type} id     The id currently stored in the `items` array
		 * @param  {Object} item The full data of object
		 * @return {void}
		 */
		setItemById(id, item) {
			const index = this.items.indexOf(id);

			if (index < 0) {
				console.warn('trying to replace an item that is not in the list', id, item);
				return;
			}

			this.set(['items', index], this._cache[id] = item);
			this._isPreloading = false;
			this._preload();

			if (this.animating) {
				return;
			}
			if (index === this.selected) {
				return this._updateSelected();
			}
			this._synchronize();
		},

		_forwardParentProp(prop, value) {
			const instances = this._templateInstances;
			if (!instances || !instances.length) {
				return;
			}
			instances.forEach(inst => inst[prop] = value);
		},

		_forwardParentPath(path, value) {
			const instances = this._templateInstances;
			if (!instances || !instances.length) {
				return;
			}
			instances.forEach(inst => inst.notifyPath(path, value, true));
		},

		_forwardHostPropV2(prop, value) {
			const instances = this._templateInstances;
			if (!instances || !instances.length) {
				return;
			}
			instances.forEach(inst => inst.forwardHostProp(prop, value));
		},

		/**
		 * Observes full changes to `items` properties
		 * and replaces cached items with full data if available.
		 *
		 * @param  {type} items description
		 * @return {type}       description
		 */
		_itemsChanged(items) {
			const length = items && items.length;

			this._isPreloading = false;

			//Update readOnly queueLength
			this._setQueueLength(length >> 0);

			if (length) {
				items.forEach((item, index) => {
					if (this.isIncompleteFn(item) && this._cache[item]) {
						this.set(['items', index], this._cache[item]);
					}
				});
			}

			this.selected = this._preloadIdx = 0;
			this._synchronize();
			this._preload();
		},

		/**
		 * Observes changed to `selected` property and
		 * updates related properties and the `selected` page.
		 *
		 * @param  {Number} selected The selected property
		 * @return {void}
		 */
		_updateSelected(selected = this.selected) {
			this._setSelectedNext((this.selected || 0) + 1);
			this._setPrevDisabled(this.selected === 0);
			this._setNextDisabled(this.selectedNext >= this.items.length);

			const element =  this._elements[selected % this._elementsBuffer];

			if (!element) {
				return;
			}

			let classes = element.classList,
				prev = this._selectedElement;

			classes.toggle('in', this.animating);
			classes.add('selected');

			this._selectedElement = element;

			if (!this.animating) {
				this._synchronize();
				this._notifyElementResize(this._selectedElement);
				return;
			}

			requestAnimationFrame(() => {
				if (prev && prev !== this._selectedElement && element.offsetWidth) {
					prev.classList.add('out');
					prev.classList.remove('selected');
				}
				classes.remove('in');
			}, 8);
		},

		/**
		 * Handles `transitionend` event and cleans up animation classe and properties
		 *
		 * @param  {TransitionEvent} e The event
		 * @return {void}
		 */
		_onTransitionEnd(e) {
			const elements = this._elements;

			if (!this.animating || !elements.length || elements.indexOf(e.target) < 0) {
				return;
			}

			this.animating = false;
			this._elements.forEach(el => {
				const classes = el.classList;
				classes.remove('in', 'out');
			});
			this._notifyElementResize(this._selectedElement);
			this._synchronize();
			this._preload();
		},

		/**
		 * Preloads items that are not loaded depending on the currently
		 * selected item and the `preload` property.
		 *
		 * @fires need-data
		 * @return {void}
		 */
		_preload() {
			if (!Array.isArray(this.items) || this.items.length === 0 || this._isPreloading) {
				return;
			}

			const index = this._preloadIdx,
				item = this.items[index];

			if (this.isIncompleteFn(item)) {
				this._isPreloading = true;
				this.fire('need-data', { id: item, render: true });
				return;
			}

			if (index >= Math.min(this.selected + this.preload, this.items.length - 1)) {
				return;
			}

			this._preloadIdx++;
			this._preload();
		},

		/**
		 * Forwards an item from `items` property to a template instance.
		 *
		 * @param  {HTMLElement} element The element
		 * @param  {Object}      item     The item to forward
		 * @return {void}
		 */
		_forwardItem(element, item) {
			const items = this.items,
				index = items.indexOf(item),
				incomplete = this.isIncompleteFn(item);

			element.classList.toggle('incomplete', incomplete);

			if (incomplete || element.item === item) {
				return;
			}

			this._removeInstance(element.__instance);

			let instance = this.stamp({});


			instance[this.indexAs] = Math.max(index, 0);
			instance['prevDisabled'] = index < 1;
			instance['nextDisabled'] = index + 1  >= items.length;

			instance[this.as] = item;
			element.__instance = instance;
			element.item = item;

			Polymer.dom(element).appendChild(instance.root);
		},

		_removeInstance(instance) {
			if (!instance) {
				return;
			}
			const children = IS_V2 ? instance.children : instance._children;

			for (let i = 0; i < children.length; i++) {
				const child = children[i],
					parent = child.parentNode;
				Polymer.dom(parent).removeChild(child);
			}
		},

		/**
		 * Handle `tap` event and finds the closest item to the rootTarget that has a `selectAttribute` attribute.
		 * If the attribute is `next` or `previous` the `selectNext` or `selectPrevious` action is called.
		 *
		 * @param  {Event} event The tap event
		 * @return {void}
		 */
		_onTap(event) {
			if (this.animating) {
				return;
			}
			const path = Polymer.dom(event).path,
				attr = this.selectAttribute;

			let select = path.find(e => e && e.hasAttribute && e.hasAttribute(attr));
			if (!select || select.closest(this.is) !== this) {
				return;
			}
			select = parseInt(select.getAttribute(attr), 10);
			if (isNaN(select)) {
				return;
			}
			this.debounce('select', () => {
				this.animating = true;
				this.select(this.selected + select);
			}, 15);
		},

		/**
		* True if the current element is visible.
		*/
		get _isVisible() {
			return Boolean(this.offsetWidth || this.offsetHeight);
		},

		/**
		 * Check if a element is a descendant of the currently selected element.
		 *
		 * @param  {HTMLElement} element A descendant resizable element
		 * @return {Boolean} True if the element should be notified
		 */
		resizerShouldBeNotified(element) {
			return element.closest('.animatable')  === this._selectedElement;
		},


		/**
		 * Handles resize notifications from descendants.
		 *
		 * @param  {Event} event The resize event
		 * @return {void}
		 */
		_onDescendantIronResize(event) {
			if (this._notifyingDescendant || this.animating || !this._isVisible || !this.resizerShouldBeNotified(event.target)) {
				event.stopPropagation();
				return;
			}

			if (Polymer.Settings.useShadow && event.target.domHost === this) {
				return;
			}

			this._fireResize();
		},

		notifyResize() {
			if (!this.isAttached || this.animating || !this._isVisible) {
				return;
			}
			Polymer.IronResizableBehavior.notifyResize.call(this);
		},


		/**
		 * Notifies a descendant resizable of the element.
		 *
		 * @param  {HTMLElement} element The element to search within for a resizable
		 * @return {void}
		 */
		_notifyElementResize(element) {
			if (!this.isAttached) {
				return;
			}
			const resizable = this._interestedResizables.find(resizable =>
				resizable.closest('.animatable') === element
			);

			if (!resizable) {
				return;
			}

			this._notifyDescendant(resizable);
		},

		/**
		 * Select item by id.
		 *
		 * @deprecated
		 * @param  {String|Number} id The item's id
		 * @return {void}
		 */
		selectById(id) {
			var index,
				item;
			for (index = 0; index < this.items.length; index++) {
				item = this.items[index];
				if (typeof item === 'object' && item.id === id || item === id) {
					this.selected = index;
					return;
				}
			}
		},

		/**
		* Syncronizes the `items` data with the created template instances
		* depending on the currently selected item.
		*
		* @return {type}  description
		*/
		_synchronize() {
			const elements = this._elements,
				buffer = this._elementsBuffer,
				offset = buffer / 2 >> 0,
				max = Math.max,
				min = Math.min,
				length = this.items.length,
				end = max(min(this.selected + offset, length ? length - 1 : 0), buffer - 1);

			let index = min(max(this.selected - offset, 0), length ? length - buffer : 0);

			for (; index <= end; index++) {
				let element = elements[ index % buffer],
					item =  this.items[index];
				if (!element) {
					continue;
				}
				this._forwardItem(element, item);
			}
		}
	});
}());
