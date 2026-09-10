const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = "https://kulzzy.github.io";

const ALLOWED_PAGE =
  "https://kulzzy.github.io/FACE-OF-KULZZY-RADIO-/";

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


/* =====================================================
   GET CONTESTANT FROM FIREBASE
===================================================== */

async function getContestant(contestantId) {

  const secret =
    process.env.FIREBASE_DATABASE_SECRET;

  if (!secret) {
    throw new Error(
      "Firebase database secret is not configured."
    );
  }

  const url =
    FIREBASE_DATABASE_URL +
    "/faceOfKulzzy/contestants/" +
    encodeURIComponent(contestantId) +
    ".json?auth=" +
    encodeURIComponent(secret);

  const result = await fetch(url);

  if (!result.ok) {
    throw new Error(
      "Unable to read contestant."
    );
  }

  return await result.json();
}


/* =====================================================
   MAIN HANDLER
===================================================== */

exports.handler = async function (event) {

  /* ---------------------------------------------------
     CORS PREFLIGHT
  --------------------------------------------------- */

  if (event.httpMethod === "OPTIONS") {

    return response(200, {
      success: true
    });

  }


  /* ---------------------------------------------------
     ONLY POST ALLOWED
  --------------------------------------------------- */

  if (event.httpMethod !== "POST") {

    return response(405, {
      success: false,
      message: "Method not allowed."
    });

  }


  try {

    /* -------------------------------------------------
       CHECK SECRET KEYS
    ------------------------------------------------- */

    if (!process.env.FLW_SECRET_KEY) {

      return response(500, {
        success: false,
        message:
          "Flutterwave secret key is not configured."
      });

    }


    if (!process.env.FIREBASE_DATABASE_SECRET) {

      return response(500, {
        success: false,
        message:
          "Firebase database secret is not configured."
      });

    }


    /* -------------------------------------------------
       READ REQUEST
    ------------------------------------------------- */

    let data;

    try {

      data =
        JSON.parse(
          event.body || "{}"
        );

    } catch (error) {

      return response(400, {
        success: false,
        message:
          "Invalid request data."
      });

    }


    const {
      contestantId,
      amount,
      voterName,
      voterEmail,
      redirectUrl
    } = data;


    /* =================================================
       VALIDATE CONTESTANT
    ================================================= */

    if (
      !contestantId ||
      !String(contestantId).trim()
    ) {

      return response(400, {
        success: false,
        message:
          "Contestant was not selected."
      });

    }


    /* =================================================
       VALIDATE VOTER NAME
    ================================================= */

    if (
      !voterName ||
      !String(voterName).trim()
    ) {

      return response(400, {
        success: false,
        message:
          "Please enter your name."
      });

    }


    /* =================================================
       VALIDATE EMAIL
    ================================================= */

    const email =
      String(voterEmail || "")
        .trim()
        .toLowerCase();


    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {

      return response(400, {
        success: false,
        message:
          "Please enter a valid email address."
      });

    }


    /* =================================================
       VALIDATE VOTING AMOUNT
       
       ₦100 = 1 VOTE
    ================================================= */

    const numericAmount =
      Number(amount);


    if (
      !Number.isFinite(numericAmount) ||
      numericAmount < 100
    ) {

      return response(400, {
        success: false,
        message:
          "Minimum voting amount is ₦100."
      });

    }


    if (
      numericAmount % 100 !== 0
    ) {

      return response(400, {
        success: false,
        message:
          "Amount must be a multiple of ₦100."
      });

    }


    /* =================================================
       VALIDATE RETURN URL
    ================================================= */

    let safeRedirectUrl =
      ALLOWED_PAGE;


    if (redirectUrl) {

      try {

        const suppliedUrl =
          new URL(
            String(redirectUrl)
          );


        if (
          suppliedUrl.origin !==
          ALLOWED_ORIGIN
        ) {

          return response(400, {
            success: false,
            message:
              "Invalid payment return URL."
          });

        }


        /*
          Always use the official
          Face of Kulzzy page.
        */

        safeRedirectUrl =
          ALLOWED_PAGE;


      } catch (error) {

        return response(400, {
          success: false,
          message:
            "Invalid payment return URL."
        });

      }

    }


    /* =================================================
       READ CONTESTANT
    ================================================= */

    const contestant =
      await getContestant(
        String(contestantId).trim()
      );


    if (!contestant) {

      return response(404, {
        success: false,
        message:
          "Contestant not found."
      });

    }


    /* =================================================
       CHECK CONTESTANT STATUS
    ================================================= */

    if (
      contestant.active === false
    ) {

      return response(400, {
        success: false,
        message:
          "This contestant is no longer active."
      });

    }


    /* =================================================
       GET CONTESTANT NAME
    ================================================= */

    const contestantName =
      String(
        contestant.name || ""
      ).trim();


    if (!contestantName) {

      return response(400, {
        success: false,
        message:
          "Contestant information is incomplete."
      });

    }


    /* =================================================
       CREATE UNIQUE TRANSACTION REFERENCE
    ================================================= */

    const txRef =
      "KULZZY-VOTE-" +
      Date.now() +
      "-" +
      Math.floor(
        100000 +
        Math.random() * 900000
      );


    /* =================================================
       OPEN NETLIFY BLOBS STORE
    ================================================= */

    const store =
      getStore({
        name:
          "kulzzy-face-votes",

        consistency:
          "strong"
      });


    /* =================================================
       CALCULATE VOTES
       
       ₦100 = 1 vote
    ================================================= */

    const expectedVotes =
      numericAmount / 100;


    /* =================================================
       SAVE PENDING VOTE
    ================================================= */

    const pendingVote = {

      voteStatus:
        "PENDING_PAYMENT",

      txRef,

      contestantId:
        String(contestantId).trim(),

      contestantName,

      voterName:
        String(voterName).trim(),

      voterEmail:
        email,

      amount:
        numericAmount,

      expectedVotes,

      currency:
        "NGN",

      createdAt:
        new Date().toISOString()

    };


    await store.setJSON(
      `pending/${txRef}`,
      pendingVote
    );


    /* =================================================
       CREATE FLUTTERWAVE PAYMENT
    ================================================= */

    const flutterwaveResponse =
      await fetch(
        "https://api.flutterwave.com/v3/payments",
        {
          method: "POST",

          headers: {

            "Authorization":
              "Bearer " +
              process.env.FLW_SECRET_KEY,

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify({

              tx_ref:
                txRef,

              amount:
                numericAmount,

              currency:
                "NGN",

              redirect_url:
                safeRedirectUrl,

              payment_options:
                "card,banktransfer,ussd",

              customer: {

                email:
                  email,

                name:
                  String(
                    voterName
                  ).trim()

              },

              customizations: {

                title:
                  "Kulzzy Radio Network",

                description:
                  "Face of Kulzzy Radio 2026 - Vote for " +
                  contestantName,

                logo:
                  "https://kulzzy.github.io/app/icon-192.png"

              },

              meta: [

                {

                  metaname:
                    "contestantId",

                  metavalue:
                    String(
                      contestantId
                    ).trim()

                },

                {

                  metaname:
                    "contestantName",

                  metavalue:
                    contestantName

                },

                {

                  metaname:
                    "voterName",

                  metavalue:
                    String(
                      voterName
                    ).trim()

                },

                {

                  metaname:
                    "voterEmail",

                  metavalue:
                    email

                },

                {

                  metaname:
                    "voteAmount",

                  metavalue:
                    String(
                      numericAmount
                    )

                },

                {

                  metaname:
                    "votes",

                  metavalue:
                    String(
                      expectedVotes
                    )

                }

              ]

            })

        }
      );


    /* =================================================
       READ FLUTTERWAVE RESPONSE
    ================================================= */

    let flutterwaveResult;

    try {

      flutterwaveResult =
        await flutterwaveResponse.json();

    } catch {

      flutterwaveResult = {};

    }


    /* =================================================
       CHECK FLUTTERWAVE RESULT
    ================================================= */

    if (
      !flutterwaveResponse.ok ||
      flutterwaveResult.status !==
        "success" ||
      !flutterwaveResult.data ||
      !flutterwaveResult.data.link
    ) {

      console.error(
        "FLUTTERWAVE CREATE ERROR:",
        flutterwaveResult
      );


      return response(500, {

        success:
          false,

        message:
          "Unable to create Flutterwave payment."

      });

    }


    /* =================================================
       RETURN CHECKOUT URL
    ================================================= */

    return response(200, {

      success:
        true,

      txRef,

      amount:
        numericAmount,

      currency:
        "NGN",

      checkout_url:
        flutterwaveResult.data.link

    });


  } catch (error) {

    console.error(
      "CREATE VOTE PAYMENT ERROR:",
      error
    );


    return response(500, {

      success:
        false,

      message:
        error.message ||
        "Unable to create payment."

    });

  }

};
