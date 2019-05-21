/** web3 client backend for rock-paper-scissors. */
/*
  DONE:

  * All the messaging TO the blockchain, including creating a new game.
  * Follow the factory contract and collect its events.
  * Filter the events to only consider games where the user is either player0 or player1,
    or where player1 is open (0)
  * If the user is player0, try to match with games in our local storage,
    by given details.
  * Now register the game, if not already registered.
  * Have a hook for (re)displaying a contract purely based on its localStorage state,
    and have the frontend get into that hook (will skip the game if already dismissed).
    Call the hook any time a change is detected in a game.
  * For every registered game that isn't complete,
    have a loop that polls for changes in game confirmed state
    (or, alternatively, also look at unconfirmed changes).
    We're polling for recomputed state at every block.
  * Handle timeouts
  * If the user is player0 and the txHash is not be already known, do something useful
    (due to race condition with the browser crashing before localStorage was done, or use in another browser)
  * Use a post-frontend-initialization hook to only start expensive computations
    after the frontend is initialized.

  TODO FOR DEMO:

  * Move to the .ala file the things from which that are in this file
    that should be provided by the high-level programmer, such as the human-readable descriptions.

  TODO LATER MAYBE:

  * Handle the case where an open game was accepted by someone else already...
    special display, and make it dismissable.

  * Refactor to extract a clean systematic interface between frontend and backend for user input.

  * Instead of polling for contract state all the time, we could have the contract emit
    events at state transitions, and recompute the state from them.
    That would be cheaper to compute on the client and much lighter on the node, though
    it is involves more code to write. It might not cost more gas in the contract,
    since emitting events and requiring users to resubmit relevant state as arguments
    might be cheaper than storing state.

  * Improve discoverability so users don't have to care too much about being player0 or player1.

  * Survive spamming of the chain by games to DoS clients that would run out of memory:
    Only check for new games in recent blocks; cap the number of open games;
    require a small fee for opening a game?
*/
'use strict';

// These should be automatically generated from the type declaration.
const Hand = Object.freeze({Rock: 0, Paper: 1, Scissors: 2});
const handName = hand => ["Rock", "Paper", "Scissors"][hand];
const isValidHand = x => Number.isInteger(x) && (x == 0 || x == 1 || x == 2);
const randomHand = () => {
    const array = new Uint8Array(6);
    window.crypto.getRandomValues(array);
    return (array[0]+array[1]+array[2]+array[3]+array[4]+array[5]) % 3; // NB: 256 % 3 == 1
};
const handToHex = byteToHex;

// (salt, hand) => web3.utils.soliditySha3({t: 'bytes32', value: salt}, {t: 'uint8', value: hand});
// The above web3 1.0 function is NOT AVAILABLE IN METAMASK, that only has web3 0.2!
const makeCommitment = saltedDigest(handToHex);


// SENDING DATA TO THE BLOCKCHAIN
// The section below is automatically generated as FFI at the same time as the contract is generated.

// The contract object, to be fulfilled from config after initialization.
let rpsFactory;

const rpsContract = web3.eth.contract(rpsAbi);
const rps = contractAddress => rpsContract.at(contractAddress);

// TODO: replace queryState and decodeState by tracking the contract events
// and recomputing the state locally.
const decodeState = x => {
    let [state, outcome, timeoutInBlocks, previousBlock, player0, player1, player0Commitment, wagerInWei, escrowInWei, salt, hand0, hand1] = x;
    state = state.toNumber();
    outcome = outcome.toNumber();
    timeoutInBlocks = timeoutInBlocks.toNumber();
    previousBlock = previousBlock.toNumber();
    wagerInWei = toBN(wagerInWei);
    escrowInWei = toBN(escrowInWei);
    hand0 = hand0.toNumber();
    hand1 = hand1.toNumber();
    return {state, outcome, timeoutInBlocks, previousBlock, player0, player1, player0Commitment, wagerInWei, escrowInWei, salt, hand0, hand1};};

// To be autogenerated from the type declaration, if still useful.
const isEqualState = (x, y) =>
    x === y ||
    (typeof x == "object" &&
     typeof y == "object" &&
     x.state == y.state &&
     x.outcome == y.outcome &&
     x.timeoutInBlocks == y.timeoutInBlocks &&
     x.previousBlock == y.previousBlock &&
     x.player0 == y.player0 &&
     x.player1 == y.player1 &&
     x.player0Commitment == y.player0Commitment &&
     x.wagerInWei == y.wagerInWei &&
     x.escrowInWei == y.escrowInWei &&
     x.salt == y.salt &&
     x.hand0 == y.hand0 &&
     x.hand1 == y.hand1);

// address => KontE({state: Uint8, outcome: Uint8, timeoutInBlocks: int, previousBlock: int, player0: address, player1: address, player0Commitment: bytes32, wagerInWei: BN, escrowInWei: BN, salt: bytes32, hand0: Uint8, hand1: Uint8})
const queryState = (contractAddress, blockNumber) => (k, kError = kLogError) => {
    return errbacK(rps(contractAddress).query_state.call)({}, blockNumber)(x => k(decodeState(x)))};

// address => KontE(int)
const queryConfirmedState = contractAddress => (k, kError = kLogError) =>
    getConfirmedBlockNumber(
        blockNumber => queryState(contractAddress, blockNumber)(k, kError), kError);

// Decode Game Creation Data, found in event logs as posted by the contract.
// To be generated from the event type declaration, possibly with multiple cases.
const decodeGameCreationData = (data, blockNumber, txHash) => {
    const x = i => data.slice(2+i*64,66+i*64);
    const contract = hexToAddress(x(0));
    const player0 = hexToAddress(x(1));
    const player1 = hexToAddress(x(2));
    const timeoutInBlocks = hexToBigNumber(x(3)).toNumber();
    const player0Commitment = hexTo0x(x(4));
    const wagerInWei = hexToBigNumber(x(5));
    const escrowInWei = hexToBigNumber(x(6));
    return {contract, player0, player1, timeoutInBlocks,
            player0Commitment, wagerInWei, escrowInWei, blockNumber, txHash};}

// From the txHash of the transaction whereby the factory contract created the game contract,
// extract the game creation data.
// txHash => {contract: address, player0: address, player1: address, timeoutInBlocks: integer,
// commitment: bytes32, wagerInWei: BN, escrowInWei: BN, blockNumber: integer}
const getGameCreationData = txHash => (k, kError = kLogError) =>
    errbacK(web3.eth.getTransactionReceipt)(txHash)(
        receipt => {
            const result = decodeGameCreationData(receipt.logs[0].data, receipt.blockNumber, txHash);
            if(receipt.transactionHash == txHash
               && receipt.status == "0x1"
               && receipt.from == result.player0
               && receipt.to == config.contract.address
               && receipt.logs.length == 1) {
                return k(result);
            } else {
                return kError("bad rps game creation data receipt", txHash, receipt, result);
            }},
        kError);

// RECEIVING DATA FROM THE BLOCKCHAIN

// Given game data (from a decoded game creation event) and game (from local user storage),
// determine if the data matches the game.
const gameMatches = (d, g) =>
    g &&
    d.player0 == g.player0 &&
    d.player1 == g.player1 &&
    d.timeoutInBlocks == g.timeoutInBlocks &&
    d.player0Commitment == g.player0Commitment &&
    d.wagerInWei == g.wagerInWei &&
    d.escrowInWei == g.escrowInWei;

// : gameCreationEvent => Kont()
const processNewGame = event => k => {
    const game = decodeGameCreationData(event.data, event.blockNumber, event.transactionHash);
    if (!(game.player0 == userAddress || game.player1 == userAddress || game.player1 == zeroAddress)) {
        return k();
    }
    let id = gamesByTxHash[event.transactionHash];
    if (id) {
        if (id.contract) {
            // Known game. Assume blockNumber is also known and the game is rendered already.
            return k();
        }
        // TODO LATER: triple-check that everything matches, or issue warning?
        updateGame(id, {blockNumber: game.blockNumber, contract: game.contract});
        renderGameHook(id, "Process New Game:");
        return k();
    } else if (game.player0 != userAddress) {
        // A game proposed by someone else.
        registerGame(game);
        return k();
    } else {
        // Handle the case where we're player0 but we crashed between
        // the time the transaction was published and
        // the time we could save the txHash to localStorage,
        // by keeping the set of interrupted games in unconfirmedGames.
        for (let key in unconfirmedGames) {
            const id = stringToId(key);
            console.log(id, game, gameMatches(game, getGame(id)));
            if (gameMatches(game, getGame(id))) {
                updateGame(id, {blockNumber: game.blockNumber,
                                contract: game.contract,
                                txHash: game.txHash});
                gamesByTxHash[event.transactionHash] = id;
                return k();
            }
        }
        // Handle the case when we're player0 but that was started on another browser,
        // by warning the user that they better reactivate the client with the data
        // before they timeout.
        if (game.player1 == userAddress || game.player1 == zeroAddress) {
            registerGame(game);
        }
        return k();
    }
}

const watchNewGames = k =>
    registerConfirmedEventHook(
        "confirmedNewGames",
        // TODO: only track starting from 2 timeout periods in the past(?)
        config.contract.creationBlock,
        {address: config.contract.address},
        processNewGame)(k);

const State = Object.freeze({
    Uninitialized: 0,
    WaitingForPlayer1: 1,        // player0 funded wager+escrow and published a commitment
    WaitingForPlayer0Reveal: 2,  // player1 showed his hand
    Completed: 3                 // end of game (in the future, have a way to reset the contract to state Uninitialized?)
});

const Outcome = Object.freeze({
    Unknown: 0,
    Draw: 1,
    Player0Wins: 2,
    Player1Wins: 3,
    Player1WinsByDefault: 4,
    Player0Rescinds: 5
    });

const GameResult = Object.freeze({Draw: 0, YouWin: 1, TheyWin: 2});
const gameResult = (yourHand, theirHand) => (yourHand + 3 - theirHand) % 3;

// TODO: move these two functions to the front end?
// Or can it be reasonably generated from annotations in the Alacrity source code?
const player0GameResultSummary = (hand0, hand1, wagerInWei, escrowInWei) => {
    switch(gameResult(hand0, hand1)) {
    case GameResult.Draw: return `have a draw and recover your ${renderWei(toBN(wagerInWei).add(escrowInWei))} stake.`;
    case GameResult.YouWin: return `win ${renderWei(wagerInWei)} \
and recover your ${renderWei(toBN(wagerInWei).add(escrowInWei))} stake.`;
    case GameResult.TheyWin: return `lose your ${renderWei(wagerInWei)} wager \
but recover your ${renderWei(escrowInWei)} escrow.`;}}

const player1GameResultSummary = (hand0, hand1, wagerInWei, escrowInWei) => {
    switch(gameResult(hand1, hand9)) {
    case GameResult.Draw: return `have a draw and recover your ${renderWei(wagerInWei)} stake.`;
    case GameResult.YouWin: return `win ${renderWei(wagerInWei)}
and recover your ${renderWei(wagerInWei)} stake.`;
    case GameResult.TheyWin: return `lose your ${renderWei(wagerInWei)} wager.`;}}


/** Process a game, making all automated responses that do not require user input.
    This is perhaps the heart of the algorithm.
 */
// TODO: are we triggering a renderGame here when something changes, or somewhere else?
const processGameAt = confirmedBlock => id => k => {
    const game = getGame(id);
    // logging("processGameAt", id, game)();
    if (!game // No game: It was skipped due to non-atomicity of localStorage, or Garbage-Collected.
        || !game.confirmedState) { // Game issued, but no confirmed state yet. Wait for confirmation.
        return k();
    }
    if (game.confirmedState.state == State.Completed) { // Game already completed, nothing to do.
        updateGame(id, {isCompleted: true});
        removeActiveGame(id);
        return k();
    }
    if (game.player0 == userAddress &&
        game.confirmedState.state == State.WaitingForPlayer0Reveal &&
        !game.player0RevealTxHash) {
        const salt = game.salt;
        const hand0 = game.hand0;
        const hand1 = game.confirmedState.hand1;
        const context = `In game ${id}, player1 showed his hand ${handName(hand1)}. \
You must show your hand${hand0 ? ` ${handName(hand0)} to \
${player0GameResultSummary(hand0, hand1, game.wagerInWei, game.escrowInWei)}` : "."}`;
        if (salt && isValidHand(hand0)) {
            loggedAlert(`${context} Please sign the following transaction.`);
            return errbacK(rps(game.contract).player0_reveal)(salt, hand0, {})(
                txHash => {
                    updateGame(id, {player0RevealTxHash: txHash})
                    // Register txHash for confirmation? Nah, we're just polling for state change!
                    // But if we switch to event-tracking, that's where it would happen.
                    return k();},
                error => {loggedAlert(error); return k();})
        } else {
            loggedAlert(`${context} However, you do not have the salt and hand data in this client.
Be sure to start a client that has this data before the deadline.`); // TODO: print the deadline!
        }
    }
    const timeoutBlock = game.confirmedState.previousBlock + game.confirmedState.timeoutInBlocks;
    if (confirmedBlock < timeoutBlock) {
        // We haven't yet confirmed that future blocks will be > previous + timeout
        // So add the current game to the queue, if it wasn't added yet.
        queueGame(id, timeoutBlock);
        return k();
    }
    if (game.player0 == userAddress &&
        game.confirmedState.state == State.WaitingForPlayer1) {
        if (game.player0RescindTxHash) {
            return k();
        }
        const stakeInWei = toBN(game.wagerInWei).add(game.escrowInWei);
        loggedAlert(`Player1 timed out in game ${id},
sending a transaction to recover your stake of ${renderWei(game.stakeInWei)}`);
        // TODO register the event, don't send twice.
        return errbacK(rps(game.contract).player0_rescind)()(
            txHash => { updateGame(id, { player0RescindTxHash: txHash }); return k(); },
            error => { loggedAlert(error); return k(); });
    }
    if (game.confirmedState.player1 == userAddress &&
        game.confirmedState.state == State.WaitingForPlayer0Reveal &&
        !game.player1WinByDefaultTxHash) {
        const stakeInWei = toBN(game.wagerInWei).add(game.escrowInWei);
        loggedAlert(`Player0 timed out in game ${id},
sending a transaction to recover your ${renderWei(game.wagerInWei)} wager
and their ${renderWei(stakeInWei)} stake`);
        return errbacK(rps(game.contract).player1_win_by_default)({})(
            txHash => {
                updateGame(id, {player1WinByDefaultTxHash: txHash});
                return k();
            },
            flip(logErrorK)(k));
    }
    return k();
}

const processGame = id => k =>
    getConfirmedBlockNumber(block => processGameAt(block)(id)(k));

const createNewGame = (wagerInWei, escrowInWei, opponent, hand) => {
    const id = getGameID();
    // TODO: let advanced users override the salt? Not without better transaction tracking.
    const salt = randomSalt();
    const player0Commitment = makeCommitment(salt, hand);
    const player0 = userAddress;
    const player1 = opponent || zeroAddress;
    const timeoutInBlocks = config.timeoutInBlocks;
    // TODO: add the ID to the contract call for tracking purpose? Use the low bits of the escrow?
    // Or the high bits of the hand? No, use the commitment and the rest of the data.
    // Somehow when we restart transactions, we match them by content
    // and the salted commitment ought to provide enough unicity.
    // We could use the nonce for the transaction, but there's no atomic access to it.
    // Could we save the TxHash locally *before* sending it online? Unhappily web3 doesn't allow that:
    // < https://github.com/MetaMask/metamask-extension/issues/3475 >.
    putGame(id, {salt, hand0: hand, player0Commitment, player0, player1,
                 timeoutInBlocks, wagerInWei, escrowInWei});
    renderGameHook(id);
    unconfirmedGames[idToString(id)] = true;
    const commitment = makeCommitment(salt, hand);
    const totalAmount = toBN(wagerInWei).add(escrowInWei);
    return errbacK(rpsFactory.player0_start_game)(
        player1, timeoutInBlocks, commitment, wagerInWei, {value: totalAmount})(
        txHash => {
            gamesByTxHash[txHash] = id;
            addActiveGame(id);
            updateGame(id, {txHash});
            renderGameHook(id);},
        error => {
            removeGame(id);
            loggedAlert(error);});}

const dismissGame = (id, game) => {
    if (!game.isCompleted) {
        loggedAlert(`Game ${id} isn't completed yet`);
    }
    if (!game.isDismissed) {
        updateGame(id, {isDismissed: true});
    }
    renderGameHook(id, "Dismiss Game:");
}

const acceptGame = (id, hand1) => {
    const game = getGame(id);
    if (!game.confirmedState) {
        // If that's the case, make a transaction that we only send later? No, we can't with web3.
        loggedAlert(`Game ${id} isn't confirmed yet`);
        return;
    }
    if (game.confirmedState.state != State.WaitingForPlayer1) {
        loggedAlert(`Game ${id} isn't open to a wager`);
        return;
    }
    if (!(game.player1 == userAddress || game.player1 == zeroAddress)) {
        loggedAlert(`Game ${id} isn't open to you`);
        return;
    }
    if (game.player1ShowHandTxHash) {
        loggedAlert(`You already played ${game.hand1} on game ${id} in tx ${game.player1ShowHandTxHash}`);
        return;
    }
    updateGame(id, {hand1});
    return errbacK(rps(game.contract).player1_show_hand)(hand1, {value: game.wagerInWei})(
        txHash => {
            updateGame(id, {player1ShowHandTxHash: txHash});
            renderGameHook(id, "Accept Game:"); },
        loggedAlert);
}

const handleTimeoutQueueBefore = confirmedBlock => k => {
    if (timeoutBlocks.length == 0 || timeoutBlocks.peek() > confirmedBlock) {
        return k();
    } else {
        const block = timeoutBlocks.pop();
        const gameSet = popEntry(blockTimeouts, block);
        const gameList = Object.keys(gameSet).map(stringToId);
        forEachK(processGameAt(confirmedBlock))(gameList)(
            () => handleTimeoutQueueBefore(confirmedBlock)(k)); }}

const handleTimeoutQueue = (_oldBlock, currentBlock) =>
    handleTimeoutQueueBefore(currentBlock - config.confirmationsWantedInBlocks);

const processActiveGame = id => k => {
    const game = getGame(id);
    logging("processActiveGame", id, game)();
    if (!game || game.isCompleted) {
        removeActiveGame(id);
        return k();
    }
    if (!game.contract) { // Nothing to watch (yet)
        return k();
    }
    const kError = error => logErrorK(error)(k);
    return queryState(game.contract, "pending")(
        unconfirmedState =>
            game.confirmedState == unconfirmedState ? k() : // No change since last confirmed state
            queryConfirmedState(game.contract)(
                confirmedState => {
                    if (isEqualState(confirmedState, game.confirmedState) &&
                        isEqualState(unconfirmedState, game.unconfirmedState)) {
                        return k();
                    }
                    updateGame(id, {confirmedState, unconfirmedState});
                    renderGameHook(id, "Process Active Game:");
                    return getConfirmedBlockNumber(block => processGameAt(block)(id)(k));
                },
                kError),
        kError)}

const processActiveGames = (_firstUnprocessedBlock, _lastUnprocessedBlock) => k =>
      forEachK(processActiveGame)(activeGamesList())(k);

const watchActiveGames = k => {
    console.log("watchActiveGames", activeGamesList());
    newBlockHooks["confirmedActiveGames"] = processActiveGames;
    return processActiveGames()(k);
}

const initGame = id => {
    let game = getGame(id);
    if (!game) { return; }
    if (game.txHash) {
        gamesByTxHash[game.txHash] = id;
    } else {
        unconfirmedGames[idToString(id)] = true;
    }
    if (!game.isCompleted && !game.isDismissed) { addActiveGame(id); }
    renderGameHook(id, "Init Game:");
}

const initGames = k => { for(let i=0;i<nextID;i++) {initGame(i)}; return k(); }

const resumeGames = k => forEachK(processGame)(range(0, nextID))(k);

const initBackend = k => {
    if (config && config.contract) { // Avoid erroring on an unconfigured network
        rpsFactory = web3.eth.contract(rpsFactoryAbi).at(config.contract.address);
    }
    return k();
}

registerInit({
    Backend: {fun: initBackend, dependsOn: ["Runtime"]},
    Games: {fun: initGames, dependsOn: ["Frontend"]},
    ResumeGames: {fun: resumeGames, dependsOn: ["Games"]},
    WatchNewGames: {fun: watchNewGames, dependsOn: ["ResumeGames"]},
    WatchActiveGames: {fun: watchActiveGames, dependsOn: ["WatchNewGames"]},
});
