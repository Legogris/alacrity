/** web3 client frontend for rock-paper-scissors as automatically generated by Alacrity. */

import {byteToHex, registerInit, hexToAddress, hexTo0x, checkRequirement,
        loggedAlert, merge, flip, logErrorK, randomSalt,
        web3, userAddress,
        saltedDigest, registerBackendHooks, renderGame, config,
        toBN, optionalAddressOf0x, optionalAddressMatches, hexToBigNumber,
        getGame, updateGame, removeActiveGame, queueGame, attemptGameCreation, optionalAddressTo0x,
        isGameConfirmed, sendTx,
        registerContract, contractFactory, contractAt,
        renderWei, registerNetworkConfig
       } from "./alacrity-runtime.mjs";
import {isValidHand, Outcome, outcomeOfHands, State,
        registerRpsBackendHooks, player0RevealContext} from "./rps-backend.mjs";

import * as Contract from "./build/contract-auto.js";
registerContract(Contract.contractAbi, Contract.contractFactoryAbi, Contract.contractFactoryCode);
import * as Config from "./config-auto.mjs";
registerNetworkConfig(Config.networkConfig);

import * as ala from "./rps.ala.js";

export const deploy

export const decodeGameCreationEvent = (data, blockNumber, txHash) => {
    const x = i => data.slice(2+i*64,66+i*64);
    const contract = hexToAddress(x(0));
    const player0 = hexToAddress(x(1));
    const player1 = optionalAddressOf0x(hexToAddress(x(2)));
    const timeoutInBlocks = hexToBigNumber(x(3)).toNumber();
    const player0Commitment = hexTo0x(x(4));
    const wagerInWei = hexToBigNumber(x(5));
    const escrowInWei = hexToBigNumber(x(6));
    return {contract, player0, player1, timeoutInBlocks, player0Commitment, wagerInWei, escrowInWei,
            previousBlock: blockNumber, state: State.WaitingForPlayer1, player1filter: player1,
            blockNumber, txHash}}

export const MsgType = Object.freeze({
    Player0StarGame: 0,
    Player1ShowHand: 1,
    Player0Reveal: 2,
    Player0Rescind: 3,
    Player1WinByDefault: 4
});

// TODO #72: have a general-purpose variant of that based on the abi description.
export const decodeGameEvent = event => {
    const topic = event.topics[0];
    const data = event.data;
    const blockNumber = event.blockNumber;
    const txHash = event.transactionHash;
    const x = i => data.slice(2+i*64,66+i*64);
    if (topic == topics.Player1ShowHand) {
        return {msgType: MsgType.Player1ShowHand,
                player1: hexToAddress(x(0)),
                hand1: hexToBigNumber(x(1)).toNumber(),
                blockNumber, txHash}
    } else if (topic == topics.Player0Reveal) {
        return {msgType: MsgType.Player0Reveal,
                salt: hexTo0x(x(0)),
                hand0: hexToBigNumber(x(1)).toNumber(),
                outcome: hexToBigNumber(x(2)).toNumber(),
                blockNumber, txHash}
    } else if (topic == topics.Player0Rescind) {
        return {msgType: MsgType.Player0Rescind,
                blockNumber, txHash}
    } else if (topic == topics.Player1WinByDefault) {
        return {msgType: MsgType.Player1WinByDefault,
                blockNumber, txHash}}
    loggedAlert(`Unrecognized topic ${JSON.stringify({topic, data, blockNumber, txHash})}`);}

// NB: None of these checkRequirement's is useful if we trust the contract.
// NB: if we are doing speculative execution of unconfirmed messages, though,
// we may still check them to avoid a switcheroo attack, whereby the adversary
// sends a transaction to create a contract, then gets a different contract confirmed,
// but you reply to the first contract.
export const player1ShowHand = (g, msg, player1, hand1) => {
    checkRequirement(g.state == State.WaitingForPlayer1,
                     () => ["Event received in incorrect state", msg, g]);
    checkRequirement(web3.isAddress(player1) && optionalAddressMatches(g.player1, player1),
                     () => ["Invalid player1 address in event", msg, g]);
    checkRequirement(isValidHand(hand1),
                     () => ["Invalid hand1 in event", msg, g]);
    // should we check the value, too, as extracted from the tx receipt???
    return merge({player1, hand1,
                  previousBlock: msg.blockNumber, state: State.WaitingForPlayer0Reveal})(g);}

export const player0Reveal = (g, msg, salt, hand0, outcome) => {
    checkRequirement(g.state == State.WaitingForPlayer0Reveal,
                     () => ["Event received in incorrect state", msg, g]);
    checkRequirement(isValidHand(hand0),
                     () => ["Invalid hand0 in event", msg]);
    checkRequirement(!g.salt || salt == g.salt,
                     () => ["Not the salt we knew!"]);
    checkRequirement(!g.hand0 || hand0 == g.hand0,
                     () => ["Not the hand we knew!"]);
    checkRequirement(makeCommitment(salt, hand0) == g.player0Commitment,
                     () => ["commitments do not match", msg, g]);
    checkRequirement(outcome == outcomeOfHands(hand0, g.hand1),
                     () => ["unexpected outcome", msg, g]);
    return merge({salt, hand0, outcome,
                  previousBlock: msg.blockNumber, state: State.Completed, isCompleted: true})(g)}

export const checkTimeout = (g, msg) =>
    checkRequirement(msg.blockNumber > g.previousBlock + g.timeoutInBlocks,
                    () => "Over-early timeout");

// TODO: this should be just calling the continuation... but the auto output needs to implement persistence!
export const player0Rescind = (g, msg) => {
    checkRequirement(g.state == State.WaitingForPlayer1,
                    () => "Invalid state");
    checkTimeout(g, msg);
    // TODO: also check that the contract did distribute the funds as it should have?
    return merge({outcome: Outcome.Player0Rescinds,
                  previousBlock: msg.blockNumber, state: State.Completed, isCompleted: true})(g);}

export const player1WinByDefault = (g, msg) => {
    checkRequirement(g.state == State.WaitingForPlayer0Reveal,
                    () => "Invalid state");
    checkTimeout(g, msg);
    // TODO: also check that the contract did distribute the funds as it should have?
    return merge({outcome: Outcome.Player1WinByDefault,
                  previousBlock: msg.blockNumber, state: State.Completed, isCompleted: true})(g);}

export const stateUpdate = (state, event) => {
    switch (event.msgType) {
    case MsgType.Player1ShowHand:
        return player1ShowHand(state, event, event.player1, event.hand1);
    case MsgType.Player0Reveal:
        return player0Reveal(state, event, event.salt, event.hand0, event.outcome);
    case MsgType.Player0Rescind:
        return player0Rescind(state, event);
    case MsgType.Player1WinByDefault:
        return player1WinByDefault(state, event)}}

// RECEIVING DATA FROM THE BLOCKCHAIN

// Given game data (from a decoded game creation event) and game (from local user storage),
// determine if the data matches the game.
// This can be produced automatically by the compiler, together with emitting events of the proper type,
// when creating a game (with or without its own contract).
export const gameMatches = (d, g) =>
    g &&
    d.player0 == g.player0 &&
    d.player1 == g.player1 &&
    d.timeoutInBlocks == g.timeoutInBlocks &&
    d.player0Commitment == g.player0Commitment &&
    d.wagerInWei == g.wagerInWei &&
    d.escrowInWei == g.escrowInWei;

// Do we need this to automatically deal with player sets?
// const gamePlayers = game => {const {player0, player1} = game;return [player0, player1]}

// We probably don't need this function, though maybe it will help our code generator
// to have separate sub-data-structures, so as to avoid name clashes;
// alternatively, we could have hierarchical-variable-names?
// And/or we have syntax objects, for which we generate distinct variable names,
// and we know that some of those objects are mapped to fixed variable names in the backend;
// and we know to not abuse gensym suffixes to avoid clashes?
//
// const gameParameters = game => {
//    const {player0, player1, timeoutinBlocks, player0Commitment, wagerInWei, escrowInWei} = game;
//    return {player0, player1, timeoutinBlocks, player0Commitment, wagerInWei, escrowInWei}}

// This can be generated by the contract from the place of user addresses in its events.
export const isGameRelevantToUser = (game, userAddress) =>
    game.player0 == userAddress || optionalAddressMatches(game.player1, userAddress)
export const isGameInitiator = (game, userAddress) => game.player0 == userAddress;


/** Process a game, making all automated responses that do not require user input.
    This is perhaps the heart of the algorithm.
    TODO #72: "just" pull up the contract and call the suitable continuation with the suitable context.
    TODO: file an issue so the compiler helps our code persist.
 */
// TODO: are we triggering a renderGame here when something changes, or somewhere else?
export const processGameAtHook = confirmedBlock => id => k => {
    // TODO: move the beginning of this function to a common file...
    const game = getGame(id);
    // logging("processGameAtHook", id, game)();
    if (game.state == State.Completed) { // Game already completed, nothing to do.
        updateGame(id, {isCompleted: true});
        removeActiveGame(id);
        return k();}
    if (game.player0 == userAddress &&
        game.state == State.WaitingForPlayer0Reveal &&
        !game.player0RevealTxHash) {
        const salt = game.salt;
        const hand0 = game.hand0;
        const hand1 = game.hand1;
        const context = player0RevealContext(id, hand0, hand1, game.wagerInWei, game.escrowInWei);
        if (salt && isValidHand(hand0)) {
            loggedAlert(`${context} Please sign the following transaction.`);
            return sendTx(contractAt(game.contract).player0_reveal)(salt, hand0, {})(
                txHash => {
                    updateGame(id, {player0RevealTxHash: txHash})
                    // Register txHash for confirmation? Nah, we're just polling for state change!
                    // But if we switch to event-tracking, that's where it would happen.
                    return k();},
                error => {loggedAlert(error); return k();})
        } else {
            loggedAlert(`${context} However, you do not have the salt and hand data in this client.
Be sure to start a client that has this data before the deadline.`);}} // TODO: print the deadline!
    const timeoutBlock = game.previousBlock + game.timeoutInBlocks;
    if (confirmedBlock < timeoutBlock) {
        // We haven't yet confirmed that future blocks will be > previous + timeout
        // So add the current game to the queue, if it wasn't added yet.
        queueGame(id, timeoutBlock);
        return k();}
    if (game.player0 == userAddress &&
        game.state == State.WaitingForPlayer1) {
        if (game.player0RescindTxHash) {
            return k();}
        const stakeInWei = toBN(game.wagerInWei).add(game.escrowInWei);
        loggedAlert(`Player1 timed out in game ${id},
sending a transaction to recover your stake of ${renderWei(stakeInWei)}`);
        // TODO register the event, don't send twice.
        return sendTx(contractAt(game.contract).player0_rescind)({})(
            txHash => { updateGame(id, { player0RescindTxHash: txHash }); return k(); },
            error => { loggedAlert(error); return k()})}
    if (game.player1 == userAddress &&
        game.state == State.WaitingForPlayer0Reveal &&
        !game.player1WinByDefaultTxHash) {
        const stakeInWei = toBN(game.wagerInWei).add(game.escrowInWei);
        loggedAlert(`Player0 timed out in game ${id},
sending a transaction to recover your ${renderWei(game.wagerInWei)} wager
and their ${renderWei(stakeInWei)} stake`);
        return sendTx(contractAt(game.contract).player1_win_by_default)({})(
            txHash => {
                updateGame(id, {player1WinByDefaultTxHash: txHash});
                return k()},
            flip(logErrorK)(k))}
    return k()}

export const createNewGame = (wagerInWei, escrowInWei, player1, hand0) => {
    const salt = randomSalt();
    const player0Commitment = makeCommitment(salt, hand0);
    const player0 = userAddress;
    const timeoutInBlocks = config.timeoutInBlocks;
    const totalAmount = toBN(wagerInWei).add(escrowInWei);
    // TODO: add the ID to the contract call for tracking purpose? Use the low bits of the escrow?
    // Or the high bits of the hand? No, use the commitment and the rest of the data.
    // Somehow when we restart transactions, we match them by content
    // and the salted commitment ought to provide enough unicity.
    // We could use the nonce for the transaction, but there's no atomic access to it.
    // Could we save the TxHash locally *before* sending it online? Unhappily web3 doesn't allow that:
    // < https://github.com/MetaMask/metamask-extension/issues/3475 >.
    return attemptGameCreation(
        {salt, hand0, player0Commitment, player0, player1, timeoutInBlocks, wagerInWei, escrowInWei})(
        contractFactory.player0_start_game)(
        optionalAddressTo0x(player1), timeoutInBlocks, player0Commitment, wagerInWei,
            {value: totalAmount})}

/** Accept a game of given id, playing given hand.
    Assumes the game is waiting for player1 and we're authorized.
    The alerts also suppose some manual annotation on some relatively low-level code.
    TODO #72: here replace this code by the net.attach code.
 */
export const acceptGame = (id, hand1) => {
    const game = getGame(id);
    // This test can be generated from a generic pattern on joining games.
    if (!isGameConfirmed(game)) {
        // If that's the case, make a transaction that we only send later? No, we can't with web3.
        loggedAlert(`Game ${id} isn't confirmed yet`);
        return;}
    // This test can be generated from the state machine,
    // but generating the text of the alert requires more cleverness or human intervention.
    // Some more generic text might do "You are trying to ... but this action is not available
    // at the currently confirmed state of the game (... click to show state graph...),
    // which instead expects ..."
    // and/or since this is about joining a game, some more specialized message could be available.
    if (game.state != State.WaitingForPlayer1) {
        loggedAlert(`Game ${id} isn't open to a wager`);
        return;}
    // Since this is about joining a game, and this could be automatically generated from a pattern
    if (!optionalAddressMatches(game.player1, userAddress)) {
        loggedAlert(`Game ${id} isn't open to you`);
        return;}
    if (game.player1ShowHandTxHash) {
        loggedAlert(`You already played ${game.hand1} on game ${id} in tx ${game.player1ShowHandTxHash}`);
        return;}
    updateGame(id, {hand1});
    return sendTx(contractAt(game.contract).player1_show_hand)(hand1, {value: game.wagerInWei})(
        txHash => {
            updateGame(id, {player1ShowHandTxHash: txHash});
            renderGame(id, "Accept Game:"); },
        loggedAlert);}

// TODO #72: move the list of topics and its initialization to common-runtime
// in initContract.
// Just build a table (per contract kind?) from event type to topics[0] code
// (and/or possibly the table back from code to name?) by walking the abi JSON.
export const topics = {}

const initBackend = k => {
    if (contractFactory) { // Avoid erroring on an unconfigured network
        topics.Created = contractFactory.Created().options.topics[0];
        //topics.Player0StartGame = contractAt().Player0StartGame().options.topics[0];
        topics.Player1ShowHand = contractAt().Player1ShowHand().options.topics[0];
        topics.Player0Reveal = contractAt().Player0Reveal().options.topics[0];
        //topics.Player0Rescind = contractAt().Player0Rescind().options.topics[0];
        //topics.Player1WinByDefault = contractAt().Player1WinByDefault().options.topics[0]
    }
    return k()}

registerBackendHooks({
    processGameAtHook, decodeGameCreationEvent, decodeGameEvent,
    gameMatches, isGameRelevantToUser, isGameInitiator, stateUpdate})

registerRpsBackendHooks({
    MsgType, createNewGame, acceptGame, isGameRelevantToUser})

registerInit({
    Backend: {fun: initBackend, dependsOn: ["Contract"]}})

// Local Variables:
// mode: JavaScript
// End:
