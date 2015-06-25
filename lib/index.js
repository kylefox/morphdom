var Queue = require('tiny-queue');

var specialAttrHandlers = {
    /**
     * The "value" attribute is special for the <input> element
     * since it sets the initial value. Changing the "value"
     * attribute without changing the "value" property will have
     * no effect since it is only used to the set the initial value.
     */
    INPUT$value: function(el, value) {
        el.value = value;
    }
};

function morphAttrs(fromNode, toNode) {
    var attrs = toNode.attributes;
    var i;
    var attr;
    var attrName;

    var foundAttrs = {};
    var tagName = fromNode.tagName;

    for (i=attrs.length-1; i>=0; i--) {
        attr = attrs[i];
        if (attr.specified !== false) {
            attrName = attr.name;
            var attrValue = attr.value;
            foundAttrs[attrName] = true;

            var specialHandler = specialAttrHandlers[tagName + '$' + attrName.toLowerCase()];

            fromNode.setAttribute(attrName, attrValue);

            if (specialHandler) {
                specialHandler(fromNode, attrValue);
            }
        }
    }

    // Delete any extra attributes found on the original DOM element that weren't
    // found on the target element.
    attrs = fromNode.attributes;

    for (i=attrs.length-1; i>=0; i--) {
        attr = attrs[i];
        if (attr.specified !== false) {
            attrName = attr.name;
            if (!foundAttrs.hasOwnProperty(attrName)) {
                fromNode.removeAttribute(attrName);
            }
        }
    }
}

function saveEl(morpher, el) {
    morpher.saved[el.id] = el;
}

function getSavedEl(morpher, id) {
    return morpher.saved[id];
}

function morphEl(morpher, fromNode, toNode) {
    morpher.queue.push(new MorphElTask(fromNode, toNode));
}

function moveChildren(from, to) {
    var curChild = from.firstChild;
    while(curChild) {
        var nextChild = curChild.nextSibling;
        to.appendChild(curChild);
        curChild = nextChild;
    }
    return to;
}

function MorphElTask(fromNode, toNode) {
    this.from = fromNode;
    this.to = toNode;
    this.node = null; // The morphed node
}

MorphElTask.prototype.run = function(morpher) {
    var fromNode = this.from;
    var toNode = this.to;

    morphAttrs(fromNode, toNode);

    var curToNode = toNode.firstChild;
    var curFromNode = fromNode.firstChild;
    var curToNodeId;

    var fromNextSibling;
    var toNextSibling;
    var savedEl;


    outer: while(curToNode) {
        toNextSibling = curToNode.nextSibling;

        curToNodeId = curToNode.id;

        if (curToNodeId && (savedEl = getSavedEl(morpher, curToNodeId))) {
            // console.log('Reusing saved element: ' + nodeToString(savedEl));
            fromNode.insertBefore(savedEl, curFromNode);
            morphEl(morpher, savedEl, curToNode);
            curToNode = toNextSibling;
            continue;
        }

        while(curFromNode) {
            fromNextSibling = curFromNode.nextSibling;
            var curFromNodeType = curFromNode.nodeType;

            if (curFromNodeType === curToNode.nodeType) {
                var isCompatible = false;

                if (curFromNodeType === 1) { // Both nodes being compared are Element nodes
                    if (curFromNode.tagName === curToNode.tagName) {
                        // We have compatible DOM elements
                        if (curFromNode.id || curToNodeId) {
                            // If either DOM element has an ID then we handle
                            // those differently since we want to match up
                            // by ID
                            if (curToNodeId === curFromNode.id) {
                                isCompatible = true;
                            }
                        } else {
                            isCompatible = true;
                        }
                    }

                    if (isCompatible) {
                        // We found compatible DOM elements so queue up a
                        // task to morph the compatible DOM elements
                        morphEl(morpher, curFromNode, curToNode);
                    }
                } else if (curFromNodeType === 3) { // Both nodes being compared are Text nodes
                    isCompatible = true;
                    curFromNode.nodeValue = curToNode.nodeValue;
                }

                if (isCompatible) {
                    curToNode = toNextSibling;
                    curFromNode = fromNextSibling;
                    continue outer;
                }
            }

            // No compatible match so remove the old node from the DOM
            fromNode.removeChild(curFromNode);

            // If the node has an ID then save it off since we will want
            // to reuse it in case the target DOM tree has a DOM element
            // with the same ID
            if (curFromNode.id) {
                saveEl(morpher, curFromNode);
            }

            curFromNode = fromNextSibling;
        }

        // If we got this far then we did not find a candidate match for our "to node"
        // and we exhausted all of the children "from" nodes. Therefore, we will just
        // append the current "to node" to the end
        fromNode.appendChild(curToNode);

        curToNode = toNextSibling;
        curFromNode = fromNextSibling;
    }

    // We have processed all of the "to nodes". If curFromNode is non-null then
    // we still have some from nodes left over that need to be removed
    while(curFromNode) {
        fromNextSibling = curFromNode.nextSibling;
        fromNode.removeChild(curFromNode);
        curFromNode = fromNextSibling;
    }
};

function Morpher() {
    // NOTE: We use a queue to handle DOM trees of any size without
    //       exceeding the maximum stack trace limit
    this.queue = new Queue();

    this.saved = {}; // Used to save off DOM elements with IDs
}

Morpher.prototype = {
    morph: function(fromNode, toNode) {
        var taskQueue = this.queue;

        var morphedNode = fromNode;
        var morphedNodeType = morphedNode.nodeType;
        var toNodeType = toNode.nodeType;

        // Handle the case where we are given two DOM nodes that are not
        // compatible (e.g. <div> --> <span> or <div> --> TEXT)
        if (morphedNodeType === 1) {
            if (toNodeType === 1) {
                if (morphedNode.tagName !== toNode.tagName) {
                    morphedNode = moveChildren(morphedNode, document.createElement(toNode.tagName));
                }
            } else {
                // Going from an element node to a text node
                return toNode;
            }
        } else if (morphedNodeType === 3) {
            if (toNodeType === 3) {
                morphedNode.nodeValue = toNode.nodeValue;
                return morphedNode;
            } else {
                // Text node to something else
                return toNode;
            }
        }

        morphEl(this, morphedNode, toNode);

        // Keep going until there is no more work on the queue
        while(taskQueue.length) {
            taskQueue.shift().run(this);
        }

        if (morphedNode !== fromNode && fromNode.parentNode) {
            fromNode.parentNode.replaceChild(morphedNode, fromNode);
        }

        return morphedNode;
    }
};

function morphdom(oldNode, newNode) {
    var morpher = new Morpher();
    return morpher.morph(oldNode, newNode);
}

module.exports = morphdom;