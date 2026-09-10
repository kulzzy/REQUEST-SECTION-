const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = "https://kulzzy.github.io";

const FIREBASE_DATABASE_URL =
  "https://kulzzy-radio-chat-default-rtdb.europe-west1.firebasedatabase.app";

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(body)
  };
}


/* =========================================================
   ADD VERIFIED VOTES TO FIREBASE
   Uses Firebase ETag protection so simultaneous votes
   do not overwrite each other.
========================================================= */

async function addVotesToContestant(
  contestantId,
  votesToAdd,
  databaseSecret
) {
  const url =
    `${FIREBASE_DATABASE_URL}/faceOfKulzzy/contestants/` +
    `${encodeURIComponent(contestantId)}.json?auth=${encodeURIComponent(databaseSecret)}`;

  for (let attempt = 1; attempt <= 5; attempt++) {

    const getResponse = await fetch(url, {
      method: "GET",
      headers: {
        "X-Firebase-ETag": "true"
      }
    });

    if (!getResponse.ok) {
      throw new Error(
        `Firebase contestant read failed: ${getResponse.status}`
      );
    }

    const contestant = await getResponse.json();

    if (!contestant) {
      throw new Error("Contestant not found.");
    }

    const currentVotes = Number(contestant.votes || 0);

    const newTotalVotes =
      currentVotes + Number(votesToAdd);

    const etag =
      getResponse.headers.get("ETag");

    if (!etag) {
      throw new Error("Firebase ETag was not returned.");
    }

    const updatedContestant = {
      ...contestant,
      votes: newTotalVotes
    };

    const putResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "if-match": etag
      },
      body: JSON.stringify(updatedContestant)
    });

    if (putResponse.status === 412) {
      continue;
    }

    if (!putResponse.ok) {
      const errorText = await putResponse.text();

      throw new Error(
        `Firebase contestant update failed: ${putResponse.status} ${errorText}`
      );
    }

    return {
      contestant: updatedContestant,
      totalVotes: newTotalVotes
    };
  }

  throw new Error(
    "Unable to safely update contestant votes after several attempts."
  );
}


/* =========================================================
   MAIN FUNCTION
========================================================= */

exports.handler = async function (event) {

  if (event.httpMethod === "OPTIONS") {
    return response(200, {
      success: true
    });
  }

  if (event.httpMethod !== "POST") {
    return response(405, {
      success: false,
      message: "Method not allowed"
    });
  }

  try {

    /* -----------------------------------------------------
       CHECK REQUIRED SERVER SECRETS
    ----------------------------------------------------- */

    if (!process.env.FLW_SECRET_KEY) {
      return response(500, {
        success: false,
        message: "Flutterwave secret key is not configured."
      });
    }

    if (!process.env.FIREBASE_DATABASE_SECRET) {
      return response(500, {
        success: false,
        message: "Firebase database secret is not configured."
      });
    }


    /* -----------------------------------------------------
       READ REQUEST
    ----------------------------------------------------- */

    let data;

    try {
      data = JSON.parse(event.body || "{}");
    } catch (error) {
      return response(400, {
        success: false,
        message: "Invalid request data."
      });
    }

    const {
      txRef,
      transactionId
    } = data;


    if (!txRef) {
      return response(400, {
        success: false,
        message: "Transaction reference is required."
      });
    }

    if (!transactionId) {
      return response(400, {
        success: false,
        message: "Transaction ID is required."
      });
    }


    /* -----------------------------------------------------
       OPEN PAYMENT STORE
    ----------------------------------------------------- */

    const store = getStore({
      name: "kulzzy-face-votes",
      consistency: "strong"
    });


    /* -----------------------------------------------------
       PREVENT DUPLICATE PROCESSING
    ----------------------------------------------------- */

    const alreadyProcessed =
      await store.get(`processed/${txRef}`, {
        type: "json"
      });

    if (alreadyProcessed) {
      return response(200, {
        success: true,
        alreadyProcessed: true,
        contestantName:
          alreadyProcessed.contestantName || "",
        votesAdded:
          alreadyProcessed.votesAdded || 0,
        totalVotes:
          alreadyProcessed.totalVotes || 0,
        amount:
          alreadyProcessed.amount || 0,
        transactionId:
          alreadyProcessed.transactionId || transactionId,
        txRef
      });
    }


    /* -----------------------------------------------------
       GET PENDING PAYMENT
    ----------------------------------------------------- */

    const pending =
      await store.get(`pending/${txRef}`, {
        type: "json"
      });

    if (!pending) {
      return response(404, {
        success: false,
        message:
          "Payment record not found or has already been processed."
      });
    }


    /* -----------------------------------------------------
       VERIFY TRANSACTION WITH FLUTTERWAVE
    ----------------------------------------------------- */

    const verifyUrl =
      `https://api.flutterwave.com/v3/transactions/` +
      `${encodeURIComponent(transactionId)}/verify`;

    const flutterwaveResponse = await fetch(
      verifyUrl,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type":
            "application/json"
        }
      }
    );

    let flutterwaveData;

    try {
      flutterwaveData =
        await flutterwaveResponse.json();
    } catch (error) {
      return response(502, {
        success: false,
        message:
          "Unable to read Flutterwave verification response."
      });
    }


    if (!flutterwaveResponse.ok) {
      console.error(
        "FLUTTERWAVE VERIFY ERROR:",
        flutterwaveData
      );

      return response(400, {
        success: false,
        message:
          "Flutterwave could not verify this payment."
      });
    }


    const transaction =
      flutterwaveData &&
      flutterwaveData.data;


    if (!transaction) {
      return response(400, {
        success: false,
        message:
          "Flutterwave returned no transaction data."
      });
    }


    /* -----------------------------------------------------
       CHECK PAYMENT STATUS
    ----------------------------------------------------- */

    const paymentStatus =
      String(transaction.status || "")
        .toLowerCase();

    if (
      paymentStatus !== "successful" &&
      paymentStatus !== "completed"
    ) {
      return response(400, {
        success: false,
        message:
          "Payment has not been completed successfully.",
        paymentStatus
      });
    }


    /* -----------------------------------------------------
       CHECK TRANSACTION REFERENCE
    ----------------------------------------------------- */

    const returnedTxRef =
      String(transaction.tx_ref || "");

    if (returnedTxRef !== String(txRef)) {
      console.error(
        "TX REF MISMATCH:",
        {
          expected: txRef,
          received: returnedTxRef
        }
      );

      return response(400, {
        success: false,
        message:
          "Transaction reference does not match."
      });
    }


    /* -----------------------------------------------------
       CHECK CURRENCY
    ----------------------------------------------------- */

    const currency =
      String(transaction.currency || "")
        .toUpperCase();

    if (currency !== "NGN") {
      return response(400, {
        success: false,
        message:
          "Invalid payment currency."
      });
    }


    /* -----------------------------------------------------
       CHECK PAID AMOUNT
    ----------------------------------------------------- */

    const expectedAmount =
      Number(pending.amount);

    const paidAmount =
      Number(transaction.amount);

    if (
      !Number.isFinite(expectedAmount) ||
      expectedAmount <= 0
    ) {
      return response(400, {
        success: false,
        message:
          "Invalid pending payment amount."
      });
    }

    if (
      !Number.isFinite(paidAmount) ||
      paidAmount !== expectedAmount
    ) {
      console.error(
        "AMOUNT MISMATCH:",
        {
          expectedAmount,
          paidAmount
        }
      );

      return response(400, {
        success: false,
        message:
          "Payment amount does not match the required voting amount."
      });
    }


    /* -----------------------------------------------------
       CALCULATE VOTES
       ₦100 = 1 VOTE
    ----------------------------------------------------- */

    const votesToAdd =
      Math.floor(expectedAmount / 100);

    if (
      !Number.isInteger(votesToAdd) ||
      votesToAdd < 1
    ) {
      return response(400, {
        success: false,
        message:
          "Invalid voting amount."
      });
    }


    /* -----------------------------------------------------
       UPDATE CONTESTANT VOTES
    ----------------------------------------------------- */

    const contestantId =
      String(pending.contestantId || "").trim();

    if (!contestantId) {
      return response(400, {
        success: false,
        message:
          "Contestant information is missing."
      });
    }


    const updateResult =
      await addVotesToContestant(
        contestantId,
        votesToAdd,
        process.env.FIREBASE_DATABASE_SECRET
      );


    const contestant =
      updateResult.contestant;

    const totalVotes =
      updateResult.totalVotes;


    /* -----------------------------------------------------
       SAVE PROCESSED PAYMENT
    ----------------------------------------------------- */

    const processedPayment = {

      requestStatus: "PAID",

      txRef,

      transactionId:
        String(transaction.id || transactionId),

      contestantId,

      contestantName:
        contestant.name ||
        pending.contestantName ||
        "",

      voterName:
        pending.voterName || "",

      voterEmail:
        pending.voterEmail || "",

      amount:
        expectedAmount,

      currency: "NGN",

      votesAdded:
        votesToAdd,

      totalVotes,

      paidAmount,

      paymentStatus,

      verifiedAt:
        new Date().toISOString()
    };


    await store.setJSON(
      `processed/${txRef}`,
      processedPayment
    );


    /* -----------------------------------------------------
       MARK PENDING PAYMENT AS PAID
    ----------------------------------------------------- */

    await store.setJSON(
      `pending/${txRef}`,
      {
        ...pending,
        requestStatus: "PAID",
        transactionId:
          String(transaction.id || transactionId),
        paidAmount,
        votesAdded:
          votesToAdd,
        totalVotes,
        verifiedAt:
          new Date().toISOString()
      }
    );


    /* -----------------------------------------------------
       SUCCESS
    ----------------------------------------------------- */

    return response(200, {

      success: true,

      alreadyProcessed: false,

      contestantName:
        contestant.name ||
        pending.contestantName ||
        "",

      votesAdded:
        votesToAdd,

      totalVotes,

      amount:
        expectedAmount,

      transactionId:
        String(transaction.id || transactionId),

      txRef

    });

  } catch (error) {

    console.error(
      "VERIFY VOTE PAYMENT ERROR:",
      error
    );

    return response(500, {
      success: false,
      message:
        "Unable to verify vote payment."
    });
  }
};
