// @license Copyright (C) 2015 Neovici AB - Apache 2 License
/*global Cosmoz, Polymer */

(function () {
	'use strict';

	const _async = window.requestIdleCallback || window.requestAnimationFrame || Polymer.Base.async,
		_cancelAsync = window.cancelIdleCallback || window.cancelAnimationFrame || Polymer.Base.cancelAsync;

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
			atFirstItem: {
				type: Boolean,
				notify: true,
				readOnly: true
			},

			/**
			 *  True if last item is selected.
			 */
			atLastItem: {
				type: Boolean,
				notify: true,
				readOnly: true
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
				readOnly: true,
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
			selectedIndex: {
				type: Number,
				notify: true,
				observer: '_updateSelected'
			},

			/**
			 * The index of the next element.
			 */
			selectedIndexNext: {
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
			 * The attribute that elements which control the `selectedIndex` of this element
			 * should have. The value of the attribute can be `next` or `previous`.
			 */
			selectAttribute: {
				type: String,
				value: 'cosmoz-data-nav-select'
			},

			_entryAnimation: {
				type: String,
				value: 'slide-from-left-animation'
			},
			_exitAnimation: {
				type: String,
				value: 'slide-right-animation'
			}

		},

		behaviors: [
			Polymer.Templatizer
		],

		listeners: {
			tap: '_onTap'
		},

		/**
		 * Polymer `created` livecycle function.
		 *
		 * @return {void}
		 */
		created: function () {
			this._cache = {};
		},

		/**
		 * Polymer `ready` livecycle function.
		 *
		 * @return {void}
		 */
		ready: function () {
			this._ensureTemplatized();
		},

		/**
		 * Polymer `attached` livecycle function.
		 *
		 * @return {void}
		 */
		attached: function () {
			if (this._templateInstances.length < 3) {
				this._asyncSpawner = _async(this._spawn.bind(this));
			}
		},

		/**
		 * Polymer `detached` livecycle function.
		 *
		 * @return {void}
		 */
		detached: function () {
			if (this._asyncSpawner) {
				_cancelAsync(this._asyncSpawner);
			}
		},

		_spawn: function () {
			if (!this.isAttached) {
				return;
			}

			const instances = this._templateInstances,
				instance = this.stamp({});

			instances.push(instance);
			Polymer.dom(this).appendChild(instance.root);

			if (instances.length === 1) {
				this.$.dataNavPages.selected = 0;
			}
			if (instances.length > 2) {
				return;
			}
			this._asyncSpawner = _async(this._spawn.bind(this));
		},


		/**
		 * Select next item in the list.
		 *
		 * @return {void}
		 */
		selectNext: function () {
			var nextIndex = this.selectedIndex + 1;
			if (nextIndex  < this.queueLength) {
				this._entryAnimation = 'slide-from-right-animation';
				this._exitAnimation = 'slide-left-animation';
				this.selectedIndex = nextIndex;
			}
		},

		/**
		 * Select previous item in the list.
		 *
		 * @return {void}
		 */
		selectPrevious: function () {
			if (this.selectedIndex > 0) {
				this._entryAnimation = 'slide-from-left-animation';
				this._exitAnimation = 'slide-right-animation';
				this.selectedIndex = this.selectedIndex - 1;
			}
		},

		/**
		 * Replace an id in the `items` element list with the full data of the item.
		 *
		 * @param  {type} id     The id currently stored in the `items` array
		 * @param  {Object} item The full data of object
		 * @return {void}
		 */
		setItemById: function (id, item) {
			var index = this.items.indexOf(id);

			if (index > -1) {
				this.set(['items', index], this._cache[id] = item);
				this._isPreloading = false;
				this._synchronize();
			} else {
				console.warn('trying to replace an item that is not in the list', id, item);
			}
			this._preload();
		},

		_ensureTemplatized: function () {
			if (!this.ctor) {
				var props = {
					isFirstItem: true,
					isLastItem: true
				};

				props[this.as] = true;
				props[this.indexAs] = true;

				this._instanceProps = props;
				this._userTemplate = this.queryEffectiveChildren('template');
				this._templateInstances = [];

				if (this._userTemplate) {
					this.templatize(this._userTemplate);
				} else {
					console.warn('cosmoz-data-nav requires a template');
				}
			}
		},

		_forwardParentProp: function (prop, value) {
			if (this._templateInstances) {
				this._templateInstances.forEach(function (inst) {
					inst[prop] = value;
				}, this);
			}
		},

		_forwardParentPath: function (path, value) {
			if (this._templateInstances) {
				this._templateInstances.forEach(function (inst) {
					inst.notifyPath(path, value, true);
				});
			}
		},


		/**
		 * Observes full changes to `items` properties
		 * and replaces cached items with full data if available.
		 *
		 * @param  {type} items description
		 * @return {type}       description
		 */
		_itemsChanged: function (items) {
			var length = items && items.length;

			if (length > 0) {
				items.forEach(function (item, index) {
					if (typeof item === 'string' && this._cache[item]) {
						this.set(['items', index], this._cache[item]);
					}
				}, this);
				this.selectedIndex = this._preloadIdx = 0;
				this._preload();
			}

			//Update readOnly queueLength
			this._setQueueLength(length >> 0);
		},

		/**
		 * Observes changed to `selectedIndex` property and
		 * updates related properties and the `selected` page.
		 *
		 * @param  {type} selectedIndex description
		 * @return {type}               description
		 */
		_updateSelected: function (selectedIndex) {
			if (!this._templateInstances) {
				return;
			}

			// Update readOnly properties that depend on index
			this._setAtFirstItem(selectedIndex === 0);
			this._setAtLastItem(selectedIndex === this.items.length - 1);
			this._setSelectedIndexNext(selectedIndex + 1);

			this.$.dataNavPages.selected = selectedIndex % this._templateInstances.length;
			this._preload();
		},

		/**
		 * Preloads items that are not loaded depending on the currently
		 * selected item and the `preload` property.
		 *
		 * @fires need-data
		 * @return {void}
		 */
		_preload: function () {
			if (!this._templateInstances || !(this.items && this.items.length) || this._isPreloading) {
				return;
			}
			var index = this._preloadIdx,
				item = this.items[index];

			if (typeof item === 'string') {
				this._isPreloading = true;
				this.fire('need-data', { id: item, render: true });
			} else {
				this._synchronize();
				if (index < Math.min(this.selectedIndex + this.preload, this.items.length - 1)) {
					this._preloadIdx++;
					this._preload();
				}
			}
		},

		/**
		 * Syncronizes the `items` data with the created template instances
		 * depending on the currently selected item.
		 *
		 * @return {type}  description
		 */
		_synchronize: function () {
			var instances = this._templateInstances,
				length = instances.length,
				index = Math.max(this.selectedIndex - (length / 2 >> 0), 0);

			Array.apply(null, Array(length)).forEach(function (o, i) {
				var idx =  index + i,
					item =  this.items[idx],
					instance = this._templateInstances[ idx % length];

				if (typeof item === 'object' && instance.item !== item) {
					this._forwardItem(instance, item);
				}
			}, this);
		},

		/**
		 * Forwards an item from `items` property to a template instance.
		 *
		 * @param  {TemplateInstance} instance The template instance
		 * @param  {Object}           item     The Item to forward
		 * @return {void}
		 */
		_forwardItem: function (instance, item) {
			var index = this.items.indexOf(item);
			if (instance) {
				instance[this.as] = item;
				instance[this.indexAs] = index;
				instance['isLastItem'] = index === this.items.length - 1;
				instance['isFirstItem'] = index === 0;
			}
		},

		/**
		 * Handle `tap` event and finds the closest item to the rootTarget that has a `selectAttribute` attribute.
		 * If the attribute is `next` or `previous` the `selectNext` or `selectPrevious` action is called.
		 *
		 * @param  {Event} event The tap event
		 * @return {void}
		 */
		_onTap: function (event) {
			var target = Polymer.dom(event).rootTarget,
				select = target.closest('[' + this.selectAttribute + ']');
			if (select && select.closest(this.is) === this) {
				select = select.getAttribute(this.selectAttribute);
				if (select === 'next') {
					this.selectNext();
				} else if (select === 'previous') {
					this.selectPrevious();
				}
			}
		},

		selectById: function (id) {
			var index,
				item;
			for (index = 0; index < this.items.length; index++) {
				item = this.items[index];
				if (typeof item === 'object' && item.id === id || item === id) {
					this.selectedIndex = index;
					return;
				}
			}
		}
	});
}());
