/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const ModuleGraphConnection = require("./ModuleGraphConnection");

/** @typedef {import("./DependenciesBlock")} DependenciesBlock */
/** @typedef {import("./Dependency")} Dependency */
/** @typedef {import("./Module")} Module */
/** @typedef {import("./RequestShortener")} RequestShortener */
/** @template T @typedef {import("./util/SortableSet")<T>} SortableSet<T> */

/** @typedef {(requestShortener: RequestShortener) => string} OptimizationBailoutFunction */

class ModuleGraphModule {
	constructor() {
		/** @type {Set<ModuleGraphConnection>} */
		this.incomingConnections = new Set();
		/** @type {Set<ModuleGraphConnection>} */
		this.outgoingConnections = new Set();
		/** @type {Module | null} */
		this.issuer = null;
		/** @type {(string | OptimizationBailoutFunction)[]} */
		this.optimizationBailout = [];
		/** @type {false | true | SortableSet<string> | null} */
		this.usedExports = null;
	}
}

class ModuleGraphDependency {
	constructor() {
		/** @type {ModuleGraphConnection} */
		this.connection = undefined;
		/** @type {Module} */
		this.parentModule = undefined;
		/** @type {DependenciesBlock} */
		this.parentBlock = undefined;
	}
}

class ModuleGraph {
	constructor() {
		/** @type {Map<Dependency, ModuleGraphDependency>} */
		this._dependencyMap = new Map();
		/** @type {Map<Module, ModuleGraphModule>} */
		this._moduleMap = new Map();
		/** @type {Map<Module, Set<ModuleGraphConnection>>} */
		this._originMap = new Map();
		/** @type {Map<any, Object>} */
		this._metaMap = new Map();
	}

	/**
	 * @param {Module} module the module
	 * @returns {ModuleGraphModule} the internal module
	 */
	_getModuleGraphModule(module) {
		let mgm = this._moduleMap.get(module);
		if (mgm === undefined) {
			mgm = new ModuleGraphModule();
			this._moduleMap.set(module, mgm);
		}
		return mgm;
	}

	/**
	 * @param {Dependency} dependency the dependency
	 * @returns {ModuleGraphDependency} the internal dependency
	 */
	_getModuleGraphDependency(dependency) {
		let mgd = this._dependencyMap.get(dependency);
		if (mgd === undefined) {
			mgd = new ModuleGraphDependency();
			this._dependencyMap.set(dependency, mgd);
		}
		return mgd;
	}

	/**
	 * @param {Dependency} dependency the dependency
	 * @param {DependenciesBlock} block parent block
	 * @param {Module} module parent module
	 * @returns {void}
	 */
	setParents(dependency, block, module) {
		const mgd = this._getModuleGraphDependency(dependency);
		mgd.parentBlock = block;
		mgd.parentModule = module;
	}

	/**
	 * @param {Dependency} dependency the dependency
	 * @returns {Module} parent module
	 */
	getParentModule(dependency) {
		const mgd = this._getModuleGraphDependency(dependency);
		return mgd.parentModule;
	}

	/**
	 * @param {Dependency} dependency the dependency
	 * @returns {DependenciesBlock} parent block
	 */
	getParentBlock(dependency) {
		const mgd = this._getModuleGraphDependency(dependency);
		return mgd.parentBlock;
	}

	/**
	 * @param {Module} originModule the referencing module
	 * @param {Dependency} dependency the referencing dependency
	 * @param {Module} module the referenced module
	 * @returns {void}}
	 */
	setResolvedModule(originModule, dependency, module) {
		const connection = new ModuleGraphConnection(
			originModule,
			dependency,
			module
		);
		const mgd = this._getModuleGraphDependency(dependency);
		mgd.connection = connection;
		const connections = this._getModuleGraphModule(module).incomingConnections;
		connections.add(connection);
		const originConnections = this._getModuleGraphModule(originModule)
			.outgoingConnections;
		originConnections.add(connection);
	}

	/**
	 * @param {Dependency} dependency the referencing dependency
	 * @param {Module} module the referenced module
	 * @returns {void}
	 */
	updateModule(dependency, module) {
		const { connection } = this._getModuleGraphDependency(dependency);
		if (connection.module === module) return;
		const oldMgm = this._getModuleGraphModule(connection.module);
		oldMgm.incomingConnections.delete(connection);
		connection.module = module;
		const newMgm = this._getModuleGraphModule(module);
		newMgm.incomingConnections.add(connection);
	}

	/**
	 * @param {Dependency} dependency the referencing dependency
	 * @param {string} explanation an explanation
	 * @returns {void}
	 */
	addExplanation(dependency, explanation) {
		const { connection } = this._getModuleGraphDependency(dependency);
		connection.addExplanation(explanation);
	}

	/**
	 * @param {Module} oldModule the old referencing module
	 * @param {Module} newModule the new referencing module
	 * @param {function(ModuleGraphConnection): boolean} filterConnection filter predicate for replacement
	 * @returns {void}
	 */
	replaceModule(oldModule, newModule, filterConnection) {
		if (oldModule === newModule) return;
		const oldMgm = this._getModuleGraphModule(oldModule);
		const newMgm = this._getModuleGraphModule(newModule);
		const oldConnections = oldMgm.outgoingConnections;
		const newConnections = newMgm.outgoingConnections;
		for (const connection of oldConnections) {
			if (filterConnection(connection)) {
				connection.originModule = newModule;
				newConnections.add(connection);
				oldConnections.delete(connection);
			}
		}
		const oldConnections2 = oldMgm.incomingConnections;
		const newConnections2 = newMgm.incomingConnections;
		for (const connection of oldConnections2) {
			if (filterConnection(connection)) {
				connection.module = newModule;
				newConnections2.add(connection);
				oldConnections2.delete(connection);
			}
		}
	}

	/**
	 * @param {Module} module the referenced module
	 * @param {string} explanation an explanation why it's referenced
	 * @returns {void}
	 */
	addExtraReason(module, explanation) {
		const connections = this._getModuleGraphModule(module).incomingConnections;
		connections.add(new ModuleGraphConnection(null, null, module, explanation));
	}

	/**
	 * @param {Dependency} dependency the dependency to look for a referenced module
	 * @returns {Module} the referenced module
	 */
	getResolvedModule(dependency) {
		const { connection } = this._getModuleGraphDependency(dependency);
		return connection !== undefined ? connection.resolvedModule : null;
	}

	/**
	 * @param {Dependency} dependency the dependency to look for a referenced module
	 * @returns {ModuleGraphConnection | undefined} the connection
	 */
	getConnection(dependency) {
		const { connection } = this._getModuleGraphDependency(dependency);
		return connection;
	}

	/**
	 * @param {Dependency} dependency the dependency to look for a referenced module
	 * @returns {Module} the referenced module
	 */
	getModule(dependency) {
		const { connection } = this._getModuleGraphDependency(dependency);
		return connection !== undefined ? connection.module : null;
	}

	/**
	 * @param {Dependency} dependency the dependency to look for a referencing module
	 * @returns {Module} the referencing module
	 */
	getOrigin(dependency) {
		const { connection } = this._getModuleGraphDependency(dependency);
		return connection !== undefined ? connection.originModule : null;
	}

	/**
	 * @param {Dependency} dependency the dependency to look for a referencing module
	 * @returns {Module} the original referencing module
	 */
	getResolvedOrigin(dependency) {
		const { connection } = this._getModuleGraphDependency(dependency);
		return connection !== undefined ? connection.resolvedOriginModule : null;
	}

	/**
	 * @param {Module} module the module
	 * @returns {ModuleGraphConnection[]} reasons why a module is included
	 */
	getIncomingConnections(module) {
		const connections = this._getModuleGraphModule(module).incomingConnections;
		return Array.from(connections);
	}

	/**
	 * @param {Module} module the module
	 * @returns {ModuleGraphConnection[]} list of outgoing connections
	 */
	getOutgoingConnection(module) {
		const connections = this._getModuleGraphModule(module).outgoingConnections;
		return Array.from(connections);
	}

	/**
	 * @param {Module} module the module
	 * @returns {Module | null} the issuer module
	 */
	getIssuer(module) {
		const mgm = this._getModuleGraphModule(module);
		return mgm.issuer;
	}

	/**
	 * @param {Module} module the module
	 * @param {Module | null} issuer the issuer module
	 * @returns {void}
	 */
	setIssuer(module, issuer) {
		const mgm = this._getModuleGraphModule(module);
		mgm.issuer = issuer;
	}

	/**
	 * @param {Module} module the module
	 * @returns {(string | OptimizationBailoutFunction)[]} optimization bailouts
	 */
	getOptimizationBailout(module) {
		const mgm = this._getModuleGraphModule(module);
		return mgm.optimizationBailout;
	}

	/**
	 * @param {Module} module the module
	 * @returns {false | true | SortableSet<string> | null} the used exports
	 * false: module is not used at all.
	 * true: the module namespace/object export is used.
	 * SortableSet<string>: these export names are used.
	 * empty SortableSet<string>: module is used but no export.
	 * null: unknown, worst case should be assumed.
	 */
	getUsedExports(module) {
		const mgm = this._getModuleGraphModule(module);
		return mgm.usedExports;
	}

	/**
	 * @param {Module} module the module
	 * @param {false | true | SortableSet<string>} usedExports the used exports
	 * @returns {void}
	 */
	setUsedExports(module, usedExports) {
		const mgm = this._getModuleGraphModule(module);
		mgm.usedExports = usedExports;
	}

	/**
	 * @param {any} thing any thing
	 * @returns {Object} metadata
	 */
	getMeta(thing) {
		let meta = this._metaMap.get(thing);
		if (meta === undefined) {
			meta = Object.create(null);
			this._metaMap.set(thing, meta);
		}
		return meta;
	}
}

module.exports = ModuleGraph;
module.exports.ModuleGraphConnection = ModuleGraphConnection;
